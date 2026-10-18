"""Local Gemini negotiation agent for family travel preferences.

Examples:
    python agent.py analyze ..\family_1.json
    python agent.py ask ..\family_1.json U002 budgetTier
    python agent.py respond --request-id NR-001 --user-id U002 --answer accept
    python agent.py status
    python agent.py run ..\family_1.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from google import genai
from pydantic import BaseModel, Field, ValidationError

MODEL_NAME = "gemini-3.8-flash"
# CLOUD INTEGRATION: Keep this model/configuration server-side. The browser
# should call an application endpoint; it must never receive GEMINI_API_KEY.
STATE_FILE = Path(__file__).with_name("negotiation_state.json")
# CLOUD INTEGRATION: Replace this single process-wide file with family-scoped
# records keyed by family ID. A shared local file mixes families and is not
# safe for concurrent worker requests.
DEFAULT_FAMILY_FILE = Path(__file__).parent.parent / "family_1.json"
LOCAL_FAMILY_ROOT = Path(__file__).parent.parent.resolve()

NUMERIC_THRESHOLDS = {
    "tripPace": 0.2,
    "travelStyle": 0.2,
    "activityPopularity": 0.3,
}
MAX_REQUESTS_PER_PREFERENCE = 2
# Keep the whole family negotiation bounded while allowing larger families
# additional requests. This preserves the previous two-person cap of 12.
BASE_TOTAL_REQUESTS = 4
REQUESTS_PER_FAMILY_MEMBER = 4
NON_NEGOTIABLE = {"dietaryRestrictions", "luggagePreference"}
PREFERENCE_GUIDANCE = {
    "tripPace": "How densely activities are scheduled, from relaxed (0) to fast-paced (1).",
    "travelStyle": "How exploratory the itinerary is, from relaxed (0) to exploratory (1).",
    "activityPopularity": "Preference for less popular (0) versus very popular (1) attractions.",
    "budgetTier": "Budget level: 1 low, 2 medium, 3 high. Discuss cost tradeoffs instead of averaging blindly.",
    "morningRoutine": "Preferred start: early, midway, or late.",
    "interestedInShopping": "Whether the traveler wants shopping included.",
}


class UserRef(BaseModel):
    user_id: str
    name: str


class Conflict(BaseModel):
    preference: str
    description: str
    priority: str
    users: list[dict[str, Any]]
    resolution: Literal["negotiate", "accommodate", "split", "review"]
    gap: float | None = None


class NegotiationAction(BaseModel):
    action: Literal["ask_user", "recommend_split", "accommodate", "review"]
    target_participant: str | None = None
    target_user_id: str | None = None
    proposed_value: Any = None
    question: str | None = None
    rationale: str


class NegotiationRequest(BaseModel):
    # CLOUD INTEGRATION: Persist family_id, requester identity, target identity,
    # and a version of the source preferences with this record. The server must
    # authorize reads/writes against family membership and target_user_id.
    request_id: str
    family_file: str
    target_user_id: str
    target_name: str
    preference: str
    current_value: Any
    proposed_value: Any
    question: str
    rationale: str
    status: Literal["pending", "accepted", "rejected", "superseded"]
    created_at: str
    answered_at: str | None = None
    response_note: str | None = None
    attempt: int = 1


class AgentState(BaseModel):
    # CLOUD INTEGRATION: This aggregate is a local prototype only. Store
    # requests, negotiated values, and resolution state in a transactional
    # family-scoped record or Durable Object before enabling multiple writers.
    requests: list[NegotiationRequest] = Field(default_factory=list)
    # Keep accepted values in the negotiation audit state as well as writing
    # them to the family JSON, so the decision remains traceable.
    negotiated_values: dict[str, dict[str, Any]] = Field(default_factory=dict)
    resolved_preferences: dict[str, str] = Field(default_factory=dict)


def utc_now() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path) -> dict[str, Any]:
    """Load and minimally validate a family JSON file."""
    # CLOUD INTEGRATION: Replace path-based input with a server-side family
    # repository lookup. Never let a client choose an arbitrary filesystem path.
    path = resolve_family_path(path)
    try:
        with path.open(encoding="utf-8") as file:
            value = json.load(file)
    except FileNotFoundError as error:
        raise ValueError(f"Family file not found: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Family file is not valid JSON: {path}") from error
    if not isinstance(value, dict) or not isinstance(value.get("users"), list):
        raise ValueError("Family JSON must be an object containing a users array.")
    return value


def resolve_family_path(path: Path) -> Path:
    """Resolve a local family file and reject paths outside the fixture directory."""
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(LOCAL_FAMILY_ROOT)
    except ValueError as error:
        raise ValueError("Family file must be inside the local AIPipeline directory.") from error
    if resolved.suffix.casefold() != ".json":
        raise ValueError("Family file must be a JSON file.")
    return resolved


def load_state() -> AgentState:
    """Load persisted negotiation state or return an empty state if none exists."""
    # CLOUD INTEGRATION: Read state by authenticated family ID, not from a
    # process-local path. Missing state should be initialized atomically.
    if not STATE_FILE.exists():
        return AgentState()
    try:
        return AgentState.model_validate_json(STATE_FILE.read_text(encoding="utf-8"))
    except ValidationError as error:
        raise ValueError(f"Negotiation state is invalid: {STATE_FILE}") from error


def save_state(state: AgentState) -> None:
    """Persist negotiation requests and accepted values to the local state file."""
    # CLOUD INTEGRATION: Use an atomic transaction/version check here. Two
    # simultaneous responses must not overwrite one another.
    STATE_FILE.write_text(
        json.dumps(state.model_dump(), indent=2) + "\n",
        encoding="utf-8",
    )


def save_family(family_file: Path, family: dict[str, Any]) -> None:
    """Write the updated family preferences to the local family JSON file."""
    # CLOUD INTEGRATION: Replace this file write with a transaction on the
    # family record. The accepted preference and request status must commit
    # together so a retry cannot leave them out of sync.
    family_file = resolve_family_path(family_file)
    family_file.write_text(
        json.dumps(family, indent=2) + "\n",
        encoding="utf-8",
    )


def apply_accepted_preference(
    family: dict[str, Any],
    user_id: str,
    preference: str,
    value: Any,
) -> None:
    """Apply an accepted negotiation value to the matching family member."""
    for user in family["users"]:
        if user.get("userProfile", {}).get("userId") == user_id:
            user.setdefault("userTravelProfile", {}).setdefault(preference, {})[
                "value"
            ] = value
            return
    raise ValueError(f"User ID not found: {user_id}")


def users_from_family(family: dict[str, Any]) -> list[UserRef]:
    """Extract validated user IDs and names from a family JSON object."""
    result = []
    for user in family["users"]:
        profile = user.get("userProfile", {})
        user_id = profile.get("userId")
        name = profile.get("name")
        if not user_id or not name:
            raise ValueError("Every family user must have userProfile.userId and name.")
        result.append(UserRef(user_id=user_id, name=name))
    if not result:
        raise ValueError("The family must contain at least one user.")
    return result


def max_total_requests(family: dict[str, Any]) -> int:
    """Return the bounded request cap based on the number of family members."""
    return BASE_TOTAL_REQUESTS + REQUESTS_PER_FAMILY_MEMBER * len(users_from_family(family))


def has_multiple_users(family: dict[str, Any]) -> bool:
    """Return whether the family has enough members for negotiation."""
    return len(users_from_family(family)) > 1


def preference_entries(family: dict[str, Any], key: str) -> list[dict[str, Any]]:
    """Collect one preference's values, priorities, and user identities."""
    entries = []
    for user in family["users"]:
        profile = user["userProfile"]
        preference = user.get("userTravelProfile", {}).get(key)
        if preference and "value" in preference:
            entries.append({
                "user_id": profile["userId"],
                "name": profile["name"],
                "value": preference["value"],
                "priority": preference.get("priority", "flexible"),
            })
    return entries


def effective_family(family: dict[str, Any], state: AgentState) -> dict[str, Any]:
    """Return a copy of the current family record for conflict analysis."""
    # The family JSON is the source of truth after an accepted negotiation.
    # Keep state as audit history only; never overlay it because it may be
    # older than a later family-membership or preference update.
    return json.loads(json.dumps(family))


def detect_conflicts(
    family: dict[str, Any],
    state: AgentState | None = None,
) -> list[Conflict]:
    """Find meaningful preference differences and classify how to handle them."""
    if state is not None:
        family = effective_family(family, state)
    users_from_family(family)
    keys = sorted({
        key
        for user in family["users"]
        for key in user.get("userTravelProfile", {})
    })
    conflicts = []
    for key in keys:
        entries = preference_entries(family, key)
        values = [entry["value"] for entry in entries]
        if len(entries) < 2 or len({json.dumps(value, sort_keys=True) for value in values}) < 2:
            continue
        priorities = {entry["priority"] for entry in entries}
        priority = "critical" if "critical" in priorities else next(iter(priorities))
        gap = None
        resolution: Literal["negotiate", "accommodate", "split", "review"] = "review"
        if key in NON_NEGOTIABLE:
            resolution = "accommodate"
        elif all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in values):
            gap = max(values) - min(values)
            threshold = NUMERIC_THRESHOLDS.get(key, 0)
            resolution = "negotiate" if gap > threshold else "accommodate"
        elif key in {"morningRoutine", "interestedInShopping"}:
            resolution = "split"
        elif priority != "critical":
            resolution = "negotiate"
        conflicts.append(Conflict(
            preference=key,
            description=PREFERENCE_GUIDANCE.get(key, "Conflicting family preference."),
            priority=priority,
            users=entries,
            resolution=resolution,
            gap=gap,
        ))
    return conflicts


def find_user(family: dict[str, Any], user_id: str) -> UserRef:
    """Find a family member by ID or raise an error for an unknown user."""
    for user in users_from_family(family):
        if user.user_id == user_id:
            return user
    raise ValueError(f"User ID not found: {user_id}")


def create_client() -> genai.Client:
    """Create a Gemini client using the GEMINI_API_KEY environment variable."""
    # CLOUD INTEGRATION: This call belongs in the trusted worker/server runtime.
    # Keep the key in a server secret and add bounded retry/rate-limit handling.
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


def ask_gemini(conflict: Conflict, target_user_id: str | None = None) -> NegotiationAction:
    """Ask Gemini for one structured, neutral action for a preference conflict."""
    # CLOUD INTEGRATION: Persist an idempotency key with the conflict/request
    # before calling Gemini so retries cannot create duplicate requests.
    participants = [
        {
            "participant": f"traveler_{index}",
            "value": entry["value"],
            "priority": entry["priority"],
        }
        for index, entry in enumerate(conflict.users, start=1)
    ]
    target_participant = next(
        (
            f"traveler_{index}"
            for index, entry in enumerate(conflict.users, start=1)
            if entry["user_id"] == target_user_id
        ),
        None,
    )
    prompt = {
        "role": "You are a neutral travel-preference negotiator.",
        "rules": [
            "Never negotiate away dietary restrictions or luggage requirements.",
            "Ask one specific user one neutral, voluntary question at a time.",
            "For budget tiers, discuss a concrete cost compromise instead of averaging numbers.",
            "Recommend a split when preferences cannot reasonably be combined.",
            "Never claim a user agreed before a response is recorded.",
            "When selecting a participant, return its traveler_N label in target_participant; never invent a real user ID.",
        ],
        "conflict": {
            "preference": conflict.preference,
            "description": conflict.description,
            "priority": conflict.priority,
            "gap": conflict.gap,
            "participants": participants,
        },
        "requested_target": target_participant,
        "output": "Return one structured negotiation action.",
    }
    response = create_client().interactions.create(
        model=MODEL_NAME,
        input=json.dumps(prompt),
        generation_config={"thinking_level": "low"},
        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": NegotiationAction.model_json_schema(),
        },
    )
    if not response.output_text:
        raise RuntimeError("Gemini returned an empty negotiation action.")
    action = NegotiationAction.model_validate_json(response.output_text)
    if action.target_participant:
        participant_ids = {
            f"traveler_{index}": entry["user_id"]
            for index, entry in enumerate(conflict.users, start=1)
        }
        selected_user_id = participant_ids.get(action.target_participant)
        if selected_user_id is None:
            raise ValueError("Gemini selected an unknown participant.")
        action = action.model_copy(update={"target_user_id": selected_user_id})
    if target_user_id and action.target_user_id not in {None, target_user_id}:
        raise ValueError("Gemini selected a different target than the requested user.")
    if action.target_user_id and not any(
        entry["user_id"] == action.target_user_id for entry in conflict.users
    ):
        raise ValueError("Gemini selected a user outside the family conflict.")
    return action


def reconcile_state(family_file: Path, state: AgentState) -> list[Conflict]:
    """Re-evaluate all members after a response and stop resolved negotiations."""
    # CLOUD INTEGRATION: Run this after a transaction commits a response. The
    # job should be idempotent and enqueue delivery of any next request rather
    # than relying on a long-running CLI process.
    # The family is loaded again for every reconciliation. In the cloud
    # adapter, replace this with an authoritative family-record read so users
    # added after the previous request are included immediately.
    family = load_json(family_file)
    conflicts = detect_conflicts(family, state)
    active_preferences = {conflict.preference for conflict in conflicts}
    for preference in list(state.resolved_preferences):
        if preference in active_preferences:
            del state.resolved_preferences[preference]
    for request in state.requests:
        if request.status == "pending" and request.preference not in active_preferences:
            request.status = "superseded"
    for conflict in conflicts:
        attempts = [
            request for request in state.requests
            if request.preference == conflict.preference
        ]
        if conflict.resolution == "accommodate":
            state.resolved_preferences[conflict.preference] = "accommodate"
        elif conflict.resolution == "split":
            state.resolved_preferences[conflict.preference] = "split"
        elif len(attempts) >= MAX_REQUESTS_PER_PREFERENCE and not any(
            request.status == "pending" for request in attempts
        ):
            state.resolved_preferences[conflict.preference] = "stopped_after_limit"
    save_state(state)
    return conflicts


def print_analysis(family: dict[str, Any]) -> None:
    """Print detected conflicts and their deterministic resolution recommendations."""
    conflicts = detect_conflicts(family)
    if not conflicts:
        print("No significant preference conflicts found.")
        return
    for conflict in conflicts:
        values = ", ".join(
            f"{entry['name']}={entry['value']}" for entry in conflict.users
        )
        gap = f", gap={conflict.gap}" if conflict.gap is not None else ""
        print(f"- {conflict.preference}: {values}{gap}; recommendation={conflict.resolution}")


def create_request(family: dict[str, Any], family_file: Path, target_id: str, preference: str) -> None:
    """Generate and persist a Gemini negotiation request for one target user."""
    # CLOUD INTEGRATION: Resolve target_id from a family member record and
    # authorize the caller separately. Do not accept arbitrary cross-family IDs.
    if not has_multiple_users(family):
        return
    family_file = resolve_family_path(family_file)
    target = find_user(family, target_id)
    conflict = next((item for item in detect_conflicts(family) if item.preference == preference), None)
    if conflict is None:
        raise ValueError(f"No conflict found for preference: {preference}")
    if preference in NON_NEGOTIABLE:
        raise ValueError(f"{preference} is protected and cannot be negotiated.")
    action = ask_gemini(conflict, target_id)
    save_request(family_file, target, conflict, action)


def save_request(
    family_file: Path,
    target: UserRef,
    conflict: Conflict,
    action: NegotiationAction,
) -> None:
    """Validate a Gemini action and save it as a pending local request."""
    # CLOUD INTEGRATION: Replace print/save_state with a transaction that writes
    # a family-scoped request, then publishes an inbox/notification event.
    if action.action != "ask_user" or action.proposed_value is None or not action.question:
        raise ValueError(f"Gemini did not produce a user negotiation request: {action.action}")
    if conflict.preference in NON_NEGOTIABLE:
        raise ValueError(f"{conflict.preference} is protected and cannot be negotiated.")
    validate_proposed_value(conflict.preference, action.proposed_value)
    current = next(entry["value"] for entry in conflict.users if entry["user_id"] == target.user_id)
    state = load_state()
    total_request_limit = max_total_requests(load_json(family_file))
    if len(state.requests) >= total_request_limit:
        raise ValueError(
            "Negotiation stopped after reaching the family-wide limit of "
            f"{total_request_limit} requests."
        )
    request = NegotiationRequest(
        request_id=f"NR-{uuid.uuid4().hex[:8].upper()}",
        family_file=str(family_file),
        target_user_id=target.user_id,
        target_name=target.name,
        preference=conflict.preference,
        current_value=current,
        proposed_value=action.proposed_value,
        question=action.question,
        rationale=action.rationale,
        status="pending",
        created_at=utc_now(),
        attempt=sum(
            1 for existing in state.requests
            if existing.preference == conflict.preference
        ) + 1,
    )
    if request.attempt > MAX_REQUESTS_PER_PREFERENCE:
        raise ValueError(
            f"Negotiation stopped for {conflict.preference} after "
            f"{MAX_REQUESTS_PER_PREFERENCE} requests."
        )
    state.requests.append(request)
    save_state(state)
    print(request.model_dump_json(indent=2))


def validate_proposed_value(preference: str, proposed_value: Any) -> None:
    """Reject Gemini proposals that violate the local preference contract."""
    if preference in {"tripPace", "travelStyle"}:
        if (
            not isinstance(proposed_value, (int, float))
            or isinstance(proposed_value, bool)
            or not 0 <= proposed_value <= 1
        ):
            raise ValueError(f"{preference} must be a number between 0 and 1.")
    elif preference == "activityPopularity":
        if (
            not isinstance(proposed_value, (int, float))
            or isinstance(proposed_value, bool)
            or not 0 <= proposed_value <= 1
        ):
            raise ValueError("activityPopularity must be a number between 0 and 1.")
    elif preference == "budgetTier":
        if proposed_value not in {1, 2, 3}:
            raise ValueError("budgetTier must be 1, 2, or 3.")


def respond(request_id: str, user_id: str, answer: str, note: str | None) -> None:
    """Authenticate a response, persist its result, and re-evaluate consensus."""
    # CLOUD INTEGRATION: user_id is only a local-test argument. In production,
    # derive it from the verified DeepSpace session/JWT and ignore any client
    # supplied identity. Also authorize family membership and request access.
    state = load_state()
    request = next((item for item in state.requests if item.request_id == request_id), None)
    if request is None:
        raise ValueError(f"Negotiation request not found: {request_id}")
    family_file = resolve_family_path(Path(request.family_file))
    family = load_json(family_file)
    if not has_multiple_users(family):
        return
    if request.target_user_id != user_id:
        raise ValueError("Only the requested user can answer this negotiation request.")
    if request.preference in NON_NEGOTIABLE:
        raise ValueError(f"{request.preference} is protected and cannot be changed.")
    if request.status != "pending":
        raise ValueError(f"Request {request_id} is already {request.status}.")
    if answer not in {"accept", "reject"}:
        raise ValueError("Answer must be accept or reject.")
    request.status = "accepted" if answer == "accept" else "rejected"
    request.answered_at = utc_now()
    request.response_note = note
    if answer == "accept":
        # Acceptance changes the corresponding family preference immediately.
        # The family JSON is the source of truth used by later planning runs.
        apply_accepted_preference(
            family,
            request.target_user_id,
            request.preference,
            request.proposed_value,
        )
        save_family(family_file, family)
        state.negotiated_values.setdefault(request.target_user_id, {})[
            request.preference
        ] = request.proposed_value
        # CLOUD INTEGRATION: Perform the family-record update and request-status
        # update in one authorized transaction. The client must not write
        # either record directly.
    else:
        # The rejected request remains in the audit history. The reconciliation
        # below may create a new, bounded request with a different compromise.
        # CLOUD INTEGRATION: enqueue that follow-up job and return; do not block
        # this response handler while waiting for another person.
        pass
    conflicts = reconcile_state(family_file, state)
    if conflicts:
        automatically_create_requests(family, family_file)
        state = load_state()
    print(f"{request_id}: {request.status}")
    if conflicts:
        remaining = ", ".join(conflict.preference for conflict in conflicts)
        print(f"Negotiation continues for: {remaining}")
    else:
        print("Negotiation reached a stop: no unresolved conflicts remain.")


def automatically_create_requests(family: dict[str, Any], family_file: Path) -> None:
    """Create a bounded number of requests for negotiable conflicts."""
    # CLOUD INTEGRATION: Replace this loop with a queued, resumable job. Use
    # per-family locks/idempotency so two triggers do not ask the same question.
    if not has_multiple_users(family):
        return
    # This function is called after responses and should also be triggered by
    # family-membership or preference-change events in the cloud. Reload the
    # authoritative family record there rather than relying on a stale payload,
    # so newly added users participate in the next conflict evaluation.
    family = load_json(family_file)
    state = load_state()
    conflicts = reconcile_state(family_file, state)
    total_request_limit = max_total_requests(family)
    if len(state.requests) >= total_request_limit:
        for conflict in conflicts:
            if (
                conflict.resolution == "negotiate"
                and conflict.preference not in state.resolved_preferences
            ):
                state.resolved_preferences[conflict.preference] = "stopped_after_limit"
        save_state(state)
        print(
            "Negotiation stopped after reaching the family-wide limit of "
            f"{total_request_limit} requests for {len(users_from_family(family))} "
            "family members."
        )
        return

    for conflict in conflicts:
        if conflict.resolution != "negotiate":
            continue
        if conflict.preference in NON_NEGOTIABLE:
            continue
        if state.resolved_preferences.get(conflict.preference):
            continue
        if any(
            request.preference == conflict.preference and request.status == "pending"
            for request in state.requests
        ):
            continue
        if len(state.requests) >= total_request_limit:
            state.resolved_preferences[conflict.preference] = "stopped_after_limit"
            continue
        action = ask_gemini(conflict)
        if action.action != "ask_user" or not action.target_user_id:
            print(f"{conflict.preference}: Gemini recommended {action.action}.")
            continue
        target = find_user(family, action.target_user_id)
        save_request(family_file, target, conflict, action)
        state = load_state()


def run_interactive(family_file: Path) -> None:
    """Run the local prompt loop for manually selecting users and preferences."""
    # CLOUD INTEGRATION: Replace this CLI with authenticated UI/API actions.
    # User responses should arrive as server events, not typed user IDs.
    family = load_json(family_file)
    if not has_multiple_users(family):
        return
    print_analysis(family)
    print("\nEnter a user ID and preference to create a Gemini request, or press Enter to exit.")
    while True:
        target_id = input("Target user ID: ").strip()
        if not target_id:
            return
        preference = input("Preference key: ").strip()
        create_request(family, family_file, target_id, preference)


def main() -> int:
    """Parse the CLI command, execute it, and return a process exit code."""
    # CLOUD INTEGRATION: This CLI is only a local harness. The cloud adapter
    # should expose analyze/create-request/respond/status operations through
    # server routes or registered tools and return typed JSON, not console text.
    parser = argparse.ArgumentParser(description="Local Gemini family preference negotiator")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze")
    analyze.add_argument("family_file", nargs="?", type=Path, default=DEFAULT_FAMILY_FILE)

    ask = subparsers.add_parser("ask")
    ask.add_argument("family_file", type=Path)
    ask.add_argument("user_id")
    ask.add_argument("preference")

    answer = subparsers.add_parser("respond")
    answer.add_argument("--request-id", required=True)
    answer.add_argument("--user-id", required=True)
    answer.add_argument("--answer", choices=["accept", "reject"], required=True)
    answer.add_argument("--note")

    subparsers.add_parser("status")

    run = subparsers.add_parser("run")
    run.add_argument("family_file", nargs="?", type=Path, default=DEFAULT_FAMILY_FILE)
    run.add_argument(
        "--automatic",
        action="store_true",
        help="Ask Gemini to create requests for every negotiable conflict",
    )

    args = parser.parse_args()
    try:
        if args.command == "analyze":
            family = load_json(args.family_file)
            if has_multiple_users(family):
                print_analysis(family)
        elif args.command == "ask":
            create_request(load_json(args.family_file), args.family_file, args.user_id, args.preference)
        elif args.command == "respond":
            respond(args.request_id, args.user_id, args.answer, args.note)
        elif args.command == "status":
            print(load_state().model_dump_json(indent=2))
        elif args.command == "run":
            family = load_json(args.family_file)
            if not has_multiple_users(family):
                return 0
            print_analysis(family)
            if args.automatic:
                automatically_create_requests(family, args.family_file)
            else:
                run_interactive(args.family_file)
        return 0
    except (RuntimeError, ValueError, ValidationError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())