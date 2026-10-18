import { USE_REAL_BACKEND, API_BASE_URL } from "./config";
import { planFromBackend } from "./planFormat";
import sampleTrip from "../data/sampleTrip.json";

const USE_SAMPLE_PLAN = true;

const SAVED_PLAN_KEY = "travelAppSavedPlanV2_";

function membersOf(trip) {
  return trip && Array.isArray(trip.members) ? trip.members : [];
}

function writeSavedPlan(familyId, plan) {
  try {
    localStorage.setItem(SAVED_PLAN_KEY + familyId, JSON.stringify(plan));
  } catch (problem) {
    return;
  }
}

function removedGroups(previous, next, userId) {
  const retained = new Set(
    (next.days || []).flatMap((day) =>
      (day.items || []).flatMap((item) =>
        item.type === "split" ? (item.groups || []).map((group) => group.id) : []
      )
    )
  );
  return (previous?.days || []).flatMap((day) =>
    (day.items || []).flatMap((item) =>
      item.type === "split"
        ? (item.groups || [])
            .filter((group) => group.ownerId === userId && !retained.has(group.id))
            .map((group) => group.id)
        : []
    )
  );
}

function sharedPlan(plan) {
  return plan ? { ...plan, serverSynced: true } : plan;
}

function readSavedPlan(familyId) {
  try {
    const text = localStorage.getItem(SAVED_PLAN_KEY + familyId);
    return text ? JSON.parse(text) : null;
  } catch (problem) {
    return null;
  }
}

export async function getExistingPlan(familyId, trip) {
  let response;
  try {
    response = await fetch(
      `${API_BASE_URL}/families/${encodeURIComponent(familyId)}/plan`
    );
  } catch (problem) {
    if (
      (USE_REAL_BACKEND && !USE_SAMPLE_PLAN) ||
      readSavedPlan(familyId)?.serverSynced
    ) {
      throw new Error("Could not load the shared itinerary. Please try again.");
    }
    return { plan: readSavedPlan(familyId) };
  }
  if (response.ok) {
    const data = await response.json();
    const plan =
      data.format === "travel-app"
        ? data.plan
        : planFromBackend(data, membersOf(trip));
    const synchronizedPlan = sharedPlan(plan);
    writeSavedPlan(familyId, synchronizedPlan);
    return { plan: synchronizedPlan };
  }
  if (response.status !== 404) {
    throw new Error("Could not load the shared itinerary. Please try again.");
  }
  if (USE_REAL_BACKEND && !USE_SAMPLE_PLAN) {
    return { plan: null };
  }
  return { plan: readSavedPlan(familyId) };
}

export async function generateGroupPlan(familyId, requestedByUserId, trip) {
  if (USE_REAL_BACKEND && !USE_SAMPLE_PLAN) {
    const response = await fetch(
      `${API_BASE_URL}/families/${encodeURIComponent(familyId)}/plan`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: requestedByUserId }),
      }
    );
    if (response.status === 403) {
      throw new Error("Only the trip creator can generate the plan.");
    }
    if (!response.ok) {
      throw new Error("Could not generate the plan. Please try again.");
    }
    const data = await response.json();
    return { plan: planFromBackend(data, membersOf(trip)) };
  }

  const fresh = { ...planFromBackend(sampleTrip, membersOf(trip)), isSample: true };
  writeSavedPlan(familyId, fresh);
  return { plan: fresh };
}

export async function savePlan(familyId, userId, plan) {
  if ((USE_REAL_BACKEND && !USE_SAMPLE_PLAN) || plan.serverSynced) {
    const sharedPlanData = { ...plan };
    delete sharedPlanData.serverSynced;
    const removedSplitGroupIds = removedGroups(
      readSavedPlan(familyId),
      plan,
      userId
    );
    const response = await fetch(
      `${API_BASE_URL}/families/${encodeURIComponent(familyId)}/plan`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updatedBy: userId,
          plan: sharedPlanData,
          removedSplitGroupIds,
        }),
      }
    );
    if (response.status === 403) {
      throw new Error("Only people on this trip can change the plan.");
    }
    if (!response.ok) {
      throw new Error("Could not save your changes. Please try again.");
    }
    const result = await response.json();
    const synchronizedPlan = sharedPlan(result.plan || sharedPlanData);
    writeSavedPlan(familyId, synchronizedPlan);
    return { where: "server", plan: synchronizedPlan };
  }

  try {
    localStorage.setItem(SAVED_PLAN_KEY + familyId, JSON.stringify(plan));
  } catch (problem) {
    throw new Error("Could not save your changes in this browser.");
  }
  return "device";
}

export async function resetPlan(familyId, trip) {
  const fresh = { ...planFromBackend(sampleTrip, membersOf(trip)), isSample: true };
  writeSavedPlan(familyId, fresh);
  return { plan: fresh };
}

export function removeSavedPlan(familyId) {
  if (USE_REAL_BACKEND) return;
  try {
    localStorage.removeItem(SAVED_PLAN_KEY + familyId);
  } catch (problem) {
    return;
  }
}

export async function requestAlternative({ familyId, userId, stop, day, plan }) {
  const familyPath = `/families/${encodeURIComponent(familyId)}`;
  const sharedPlanData = { ...(plan || {}) };
  delete sharedPlanData.serverSynced;
  const startResponse = await fetch(`${familyPath}/plan/splits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestedBy: userId,
      dayNumber: day.dayNumber,
      itemId: stop.id,
      plan: sharedPlanData,
    }),
  });
  if (startResponse.status === 403) {
    throw new Error("Only people on this trip can split an event.");
  }
  if (!startResponse.ok) {
    const error = await startResponse.json().catch(() => null);
    throw new Error(error?.error || "Could not split this activity. Please try again.");
  }
  const start = await startResponse.json();
  if (typeof start.interactionToken !== "string" || !start.interactionToken) {
    throw new Error("The split service returned an invalid request token.");
  }

  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await fetch(
      `${familyPath}/plan/splits/${encodeURIComponent(start.interactionToken)}`
    );
    if (response.status === 202) continue;
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || "Could not save the split. Please try again.");
    }
    const data = await response.json();
    if (data.format !== "travel-app" || !data.plan || !Array.isArray(data.plan.days)) {
      throw new Error("The split service returned an invalid itinerary.");
    }
    const plan = sharedPlan(data.plan);
    writeSavedPlan(familyId, plan);
    return plan;
  }

  throw new Error("Split generation is taking longer than expected. Please try again.");
}