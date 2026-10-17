from pathlib import Path

FAMILY_CODE_ALPHABET = "0123456789"
FAMILY_CODE_LENGTH = 4
STORE_ROOT = Path.home() / ".AccCreationBackend"
FAMILY_STORE_PATH = STORE_ROOT / "families"
LEGACY_FAMILY_STORE_PATH = STORE_ROOT / "family-groups.json"


def empty_travel_profile():
    priorities = {
        "groundTransportation": "critical",
        "dietaryRestrictions": "weak_link",
        "diningCuisine": "flexible",
        "tripPace": "flexible",
        "activityFocus": "flexible",
        "activityPopularity": "flexible",
        "budgetTier": "critical",
        "morningRoutine": "flexible",
        "interestedInShopping": "flexible",
        "travelStyle": "flexible",
        "tourPreference": "flexible",
        "luggagePreference": "critical",
        "petFriendly": "weak_link",
    }
    return {
        field: {
            "value": [] if field in {"dietaryRestrictions", "activityFocus"} else None,
            "priority": priority,
        }
        for field, priority in priorities.items()
    }


def normalize_travel_profile(travel_profile):
    normalized = empty_travel_profile()
    if not isinstance(travel_profile, dict):
        return normalized

    saved_profile = dict(travel_profile)
    if "activityPopularity" not in saved_profile:
        saved_profile["activityPopularity"] = saved_profile.get(
            "attractionPopularity"
        )
    for field, entry in normalized.items():
        saved_entry = saved_profile.get(field)
        if isinstance(saved_entry, dict) and "value" in saved_entry:
            value = saved_entry["value"]
            if field in {"dietaryRestrictions", "activityFocus"}:
                if isinstance(value, list):
                    entry["value"] = value
                elif isinstance(value, str):
                    entry["value"] = [value]
            else:
                entry["value"] = value
    return normalized


def member_record(profile, organizer=False):
    user_id = profile.get("auth0_user_id") or profile["email"].strip().casefold()
    return {
        "userProfile": {
            "userId": user_id,
            "name": profile.get("name", ""),
            "email": profile["email"],
            "emailVerified": profile.get("email_verified", False),
            "organizer": organizer,
        },
        "userTravelProfile": empty_travel_profile(),
    }


def _write_json_file(path, data, prefix):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    temporary_path = None
    try:
        file_descriptor, temporary_name = tempfile.mkstemp(
            prefix=prefix, suffix=".tmp", dir=path.parent
        )
        temporary_path = Path(temporary_name)
        os.fchmod(file_descriptor, 0o600)
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as output_file:
            json.dump(data, output_file, indent=2, ensure_ascii=False)
            output_file.write("\n")
            output_file.flush()
            os.fsync(output_file.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


class LocalFamilyStore:
    def __init__(
        self,
        path=FAMILY_STORE_PATH,
        profile_store=None,
        legacy_path=None,
    ):
        self.path = Path(path)
        self.profile_store = profile_store
        self.legacy_path = Path(
            legacy_path
            if legacy_path is not None
            else (
                LEGACY_FAMILY_STORE_PATH
                if self.path == FAMILY_STORE_PATH
                else self.path.parent / "family-groups.json"
            )
        )
        self._migrate_legacy_store()

    @staticmethod
    def code_key(code):
        normalized_code = "".join(code.split()).replace("-", "").upper()
        return validate_family_code(normalized_code)

    @staticmethod
    def _normalize_member(member, profile_by_member_id=None):
        if isinstance(member, str):
            profile = (profile_by_member_id or {}).get(member)
            if profile is None:
                profile = {
                    "name": "",
                    "email": "",
                    "email_verified": False,
                    "auth0_user_id": member,
                }
            return member_record(profile)
        if not isinstance(member, dict):
            raise ValueError("Family group member data is invalid.")
        if isinstance(member.get("userProfile"), dict):
            user_profile = member["userProfile"]
            organizer = user_profile.get("organizer", False)
            if not isinstance(organizer, bool):
                raise ValueError("Family group organizer data is invalid.")
            travel_profile = member.get("userTravelProfile")
            return {
                "userProfile": {
                    "userId": user_profile.get("userId", ""),
                    "name": user_profile.get("name", ""),
                    "email": user_profile.get("email", ""),
                    "emailVerified": user_profile.get("emailVerified", False),
                    "organizer": organizer,
                },
                "userTravelProfile": (
                    normalize_travel_profile(travel_profile)
                ),
            }
        if isinstance(member.get("email"), str) and member["email"]:
            return member_record(member)
        raise ValueError("Family group member data is invalid.")

    @classmethod
    def _normalize_members(cls, members, profile_by_member_id=None):
        normalized = [
            cls._normalize_member(member, profile_by_member_id)
            for member in members
        ]
        organizer_index = next(
            (
                index
                for index, member in enumerate(normalized)
                if member["userProfile"]["organizer"]
            ),
            0 if normalized else None,
        )
        for index, member in enumerate(normalized):
            member["userProfile"]["organizer"] = index == organizer_index
        return normalized

    def _profile_lookup(self):
        if self.profile_store is None:
            return {}
        profiles = {}
        for profile in self.profile_store.all_profiles():
            if profile.get("email"):
                profiles[
                    member_key(profile["email"], profile.get("auth0_user_id"))
                ] = profile
        return profiles

    def _migrate_legacy_store(self):
        if not self.legacy_path.exists():
            return
        data = json.loads(self.legacy_path.read_text(encoding="utf-8"))
        if data.get("schemaVersion", data.get("schema_version")) != 1:
            raise ValueError(
                f"Local family store has an unsupported format: {self.legacy_path}"
            )
        saved_groups = data.get("families", data.get("groups"))
        if not isinstance(saved_groups, dict):
            raise ValueError(
                f"Local family store has an unsupported format: {self.legacy_path}"
            )

        profile_by_member_id = self._profile_lookup()
        groups = self._read_groups()
        for saved_group in saved_groups.values():
            if not isinstance(saved_group, dict):
                raise ValueError(
                    f"Local family store has invalid group data: {self.legacy_path}"
                )
            family_id = saved_group.get(
                "familyCode", saved_group.get("familyId", saved_group.get("family_id"))
            )
            family_id = self.code_key(family_id)
            members = saved_group.get("users", saved_group.get("members", []))
            if not isinstance(members, list):
                raise ValueError(
                    f"Local family store has invalid members: {self.legacy_path}"
                )
            group = {
                "family_id": family_id,
                "members": self._normalize_members(members, profile_by_member_id),
            }
            country = saved_group.get("country")
            start_date = saved_group.get("startDate")
            end_date = saved_group.get("endDate")
            if country or start_date or end_date:
                trip = {
                    "country": country or "",
                    "start_date": start_date or "",
                    "end_date": end_date or "",
                    "start_time": saved_group.get("startTime", ""),
                    "end_time": saved_group.get("endTime", ""),
                }
                if country and start_date and end_date:
                    trip = validate_trip_details(
                        trip["country"],
                        trip["start_date"],
                        trip["end_date"],
                        trip["start_time"],
                        trip["end_time"],
                    )
                group["trip"] = trip
            groups[family_id] = group

        self._write_groups(groups)
        backup_path = self.legacy_path.with_suffix(
            self.legacy_path.suffix + ".migrated"
        )
        counter = 1
        while backup_path.exists():
            backup_path = self.legacy_path.with_suffix(
                self.legacy_path.suffix + f".migrated.{counter}"
            )
            counter += 1
        os.replace(self.legacy_path, backup_path)

    def _read_groups(self):
        if not self.path.exists():
            return {}
        groups = {}
        for group_path in self.path.glob("*.json"):
            saved_group = json.loads(group_path.read_text(encoding="utf-8"))
            if not isinstance(saved_group, dict):
                raise ValueError(
                    f"Local family store has invalid group data: {group_path}"
                )
            saved_family_id = saved_group.get(
                "familyCode", saved_group.get("familyId", saved_group.get("family_id"))
            )
            try:
                family_id = self.code_key(saved_family_id)
            except (AttributeError, TypeError, ValueError) as error:
                raise ValueError(
                    f"Local family store has an invalid family ID: {group_path}"
                ) from error
            members = saved_group.get("users", saved_group.get("members", []))
            if not isinstance(members, list):
                raise ValueError(
                    f"Local family store has invalid members: {group_path}"
                )
            group = {
                "family_id": family_id,
                "members": self._normalize_members(members),
            }
            country = saved_group.get("country")
            start_date = saved_group.get("startDate")
            end_date = saved_group.get("endDate")
            if country or start_date or end_date:
                group["trip"] = {
                    "country": country,
                    "start_date": start_date,
                    "end_date": end_date,
                    "start_time": saved_group.get("startTime", ""),
                    "end_time": saved_group.get("endTime", ""),
                }
            groups[family_id] = group
        return groups

    def find(self, code):
        return self._read_groups().get(self.code_key(code))

    def find_by_family_id(self, family_id):
        for group in self._read_groups().values():
            if group.get("family_id") == family_id:
                return group
        return None

    def get_member_travel_profile(self, code, user_id):
        group = self.find(code)
        if group is None:
            return None
        for member in group["members"]:
            if member["userProfile"].get("userId") == user_id:
                return normalize_travel_profile(member.get("userTravelProfile"))
        return None

    def save_member_travel_profile(self, code, user_id, travel_profile):
        groups = self._read_groups()
        group = groups.get(self.code_key(code))
        if group is None:
            return False
        for member in group["members"]:
            if member["userProfile"].get("userId") == user_id:
                member["userTravelProfile"] = normalize_travel_profile(travel_profile)
                self._write_groups(groups)
                return True
        return False

    def update_trip(self, code, trip_details):
        groups = self._read_groups()
        group = groups.get(self.code_key(code))
        if group is None:
            return None
        group["trip"] = validate_trip_details(
            trip_details.get("country"),
            trip_details.get("start_date"),
            trip_details.get("end_date"),
            trip_details.get("start_time"),
            trip_details.get("end_time"),
        )
        self._write_groups(groups)
        return group

    def create(self, code, family_id=None, member_id=None, trip_details=None):
        groups = self._read_groups()
        key = self.code_key(code)
        if key in groups:
            raise RuntimeError("Generated family code already exists. Please run the program again.")
        family_id = self.code_key(family_id or code)
        if family_id != key:
            raise ValueError("The family ID must match the family code.")
        members = []
        if member_id:
            if isinstance(member_id, dict):
                members.append(member_record(member_id, organizer=True))
            else:
                organizer = self._normalize_member(member_id)
                organizer["userProfile"]["organizer"] = True
                members.append(organizer)
        group = {"family_id": family_id, "members": members}
        if trip_details is not None:
            if not isinstance(trip_details, dict):
                raise ValueError("Family trip settings are invalid.")
            group["trip"] = validate_trip_details(
                trip_details.get("country"),
                trip_details.get("start_date"),
                trip_details.get("end_date"),
                trip_details.get("start_time"),
                trip_details.get("end_time"),
            )
        groups[key] = group
        self._write_groups(groups)
        return family_id

    def join(self, code, family_id, member_id, profile=None):
        groups = self._read_groups()
        group = groups.get(self.code_key(code))
        if group is None:
            return None
        family_id = self.code_key(family_id)
        if group.get("family_id") != family_id:
            raise ValueError("Family code data is inconsistent. The group was not changed.")
        members = group.get("members")
        if not isinstance(members, list):
            raise ValueError("Family group data is invalid.")
        record = (
            member_record(profile)
            if profile is not None
            else self._normalize_member(member_id)
        )
        record["userProfile"]["organizer"] = not members
        existing_member_ids = set()
        for existing in members:
            user_profile = existing["userProfile"]
            existing_member_ids.add(
                member_key(
                    user_profile.get("email", ""),
                    (
                        user_profile.get("userId")
                        if user_profile.get("userId") != user_profile.get("email")
                        else None
                    ),
                )
            )
        if member_id not in existing_member_ids:
            members.append(record)
            self._write_groups(groups)
        return family_id

    def _write_groups(self, groups):
        self.path.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path.chmod(0o700)
        active_paths = set()
        for group in groups.values():
            family_id = self.code_key(group["family_id"])
            trip = group.get("trip") or {}
            record = {
                "familyCode": family_id,
                "country": trip.get("country", ""),
                "startDate": trip.get("start_date", ""),
                "endDate": trip.get("end_date", ""),
                "startTime": trip.get("start_time", ""),
                "endTime": trip.get("end_time", ""),
                "users": self._normalize_members(group.get("members", [])),
            }
            target = self.path / f"{family_id}.json"
            _write_json_file(target, record, ".family-")
            active_paths.add(target)
        for existing_path in self.path.glob("*.json"):
            if existing_path not in active_paths:
                existing_path.unlink()


def generate_family_code():
    characters = "".join(
        secrets.choice(FAMILY_CODE_ALPHABET) for _ in range(FAMILY_CODE_LENGTH)
    )
    return characters


def validate_family_code(code):
    normalized_code = "".join(code.split()).replace("-", "").upper()
    if (
        len(normalized_code) != FAMILY_CODE_LENGTH
        or any(character not in FAMILY_CODE_ALPHABET for character in normalized_code)
    ):
        raise ValueError("Enter the 4-character alphanumeric family code.")
    return normalized_code


def validate_trip_details(country, start_date, end_date, start_time, end_time):
    if not isinstance(country, str):
        raise ValueError("Enter the country your family is travelling to.")
    country = country.strip()
    if (
        not country
        or len(country) > 100
        or any(ord(character) < 32 for character in country)
    ):
        raise ValueError("Country must be between 1 and 100 characters.")
    if not isinstance(start_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_date):
        raise ValueError("Enter the travel start date as YYYY-MM-DD.")
    if not isinstance(end_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end_date):
        raise ValueError("Enter the travel end date as YYYY-MM-DD.")
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError as error:
        raise ValueError("Enter valid calendar dates for the trip.") from error
    if not isinstance(start_time, str) or not re.fullmatch(r"\d{2}:\d{2}", start_time):
        raise ValueError("Enter the travel start time in 24-hour HH:MM format.")
    if not isinstance(end_time, str) or not re.fullmatch(r"\d{2}:\d{2}", end_time):
        raise ValueError("Enter the travel end time in 24-hour HH:MM format.")
    try:
        parsed_start_time = time.fromisoformat(start_time)
        parsed_end_time = time.fromisoformat(end_time)
    except ValueError as error:
        raise ValueError("Enter valid travel times in 24-hour HH:MM format.") from error
    if (
        int(start_time[:2]) > 23
        or int(start_time[3:]) > 59
        or int(end_time[:2]) > 23
        or int(end_time[3:]) > 59
    ):
        raise ValueError("Enter valid travel times in 24-hour HH:MM format.")
    duration_days = (end - start).days
    if duration_days <= 0:
        raise ValueError("The travel end date must be after the start date.")
    return {
        "country": country,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "start_time": parsed_start_time.isoformat(timespec="minutes"),
        "end_time": parsed_end_time.isoformat(timespec="minutes"),
        "duration_days": duration_days,
        "calendar_days": duration_days + 1,
    }


def collect_trip_details():
    while True:
        country = input("Country you are travelling to: ").strip()
        start_date = input("Travel start date (YYYY-MM-DD): ").strip()
        start_time = input("Travel start time (24-hour HH:MM): ").strip()
        end_date = input("Travel end date (YYYY-MM-DD): ").strip()
        end_time = input("Travel end time (24-hour HH:MM): ").strip()
        try:
            return validate_trip_details(
                country, start_date, end_date, start_time, end_time
            )
        except ValueError as error:
            print(f"{error} Please enter the trip details again.")


def format_trip_details(trip):
    if not isinstance(trip, dict):
        return "No shared trip details are saved for this family group."
    return (
        f"Country: {trip.get('country', 'Unknown')}\n"
        f"Travel starts: {trip.get('start_date', 'Unknown')} at "
        f"{trip.get('start_time', 'Not set')}\n"
        f"Travel ends: {trip.get('end_date', 'Unknown')} at "
        f"{trip.get('end_time', 'Not set')}\n"
        f"Duration: {trip.get('duration_days', 'Unknown')} days between the dates; "
        f"{trip.get('calendar_days', 'Unknown')} calendar days including both dates"
    )


def member_key(email, auth0_user_id):
    if auth0_user_id:
        value = auth0_user_id.encode("utf-8")
        prefix = "auth0"
    else:
        value = email.strip().casefold().encode("utf-8")
        prefix = "email"
    return f"{prefix}:{hashlib.sha256(value).hexdigest()}"


def choose_family_link(family_store):
    while True:
        action = input("Before account details, choose [C]reate a family code or [J]oin with one: ")
        action = action.strip().casefold()
        if action in {"c", "create"}:
            trip_details = collect_trip_details()
            while True:
                code = generate_family_code()
                try:
                    family_id = family_store.create(code, trip_details=trip_details)
                except RuntimeError:
                    continue
                print(f"Family code: {code}")
                print("Save this code and share it privately with the other account holders.")
                print(format_trip_details(trip_details))
                return code, family_id
        if action in {"j", "join"}:
            while True:
                entered_code = input("Family code: ").strip()
                try:
                    code = validate_family_code(entered_code)
                except ValueError as error:
                    print(f"{error} Try again.")
                    continue
                group = family_store.find(code)
                if group is None:
                    print("That family code is not in this local family store. Check it and try again.")
                    continue
                family_id = group.get("family_id")
                if not isinstance(family_id, str) or not family_id:
                    raise ValueError("Family group data is invalid.")
                print(format_trip_details(group.get("trip")))
                return code, family_id
        print("Choose C to create a group or J to join an existing group.")
