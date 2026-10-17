import { USE_REAL_BACKEND, API_BASE_URL } from "./config";
import { planFromBackend } from "./planFormat";
import sampleTrip from "../data/sampleTrip.json";
import { ACTIVITY_IDEAS, MEAL_IDEAS } from "../data/alternativeIdeas";

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

function readSavedPlan(familyId) {
  try {
    const text = localStorage.getItem(SAVED_PLAN_KEY + familyId);
    return text ? JSON.parse(text) : null;
  } catch (problem) {
    return null;
  }
}

export async function getExistingPlan(familyId, trip) {
  if (USE_REAL_BACKEND && !USE_SAMPLE_PLAN) {
    try {
      const response = await fetch(
        `${API_BASE_URL}/families/${encodeURIComponent(familyId)}/plan`
      );
      if (!response.ok) return { plan: null };
      const data = await response.json();
      return { plan: planFromBackend(data, membersOf(trip)) };
    } catch (problem) {
      return { plan: null };
    }
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
  if (USE_REAL_BACKEND && !USE_SAMPLE_PLAN) {
    const response = await fetch(
      `${API_BASE_URL}/families/${encodeURIComponent(familyId)}/plan`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updatedBy: userId, plan }),
      }
    );
    if (response.status === 403) {
      throw new Error("Only people on this trip can change the plan.");
    }
    if (!response.ok) {
      throw new Error("Could not save your changes. Please try again.");
    }
    return "server";
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

function alternativeFromBackend(raw, stop, currency) {
  const cost = raw.estimated_cost
    ? { amount: Number(raw.estimated_cost.amount) || 0, currency: raw.estimated_cost.currency || currency }
    : null;
  return {
    id: raw.id || "alt-item-" + Date.now(),
    type: raw.item_type === "meal" ? "meal" : "activity",
    title: raw.title || "A different idea",
    start: raw.start_time || stop.start,
    end: raw.end_time || stop.end,
    minutes: raw.duration_minutes ?? stop.minutes,
    place: raw.location ? raw.location.name || "" : "",
    address: raw.location ? raw.location.address || "" : "",
    transit: null,
    tips: Array.isArray(raw.notes_and_tips) ? raw.notes_and_tips : [],
    cost: cost && cost.amount > 0 ? cost : null,
    addedBy: null,
  };
}

function usedTitles(day) {
  const titles = new Set();
  day.items.forEach((item) => {
    if (item.type === "split") {
      item.groups.forEach((group) => group.items.forEach((inner) => titles.add(inner.title)));
    } else {
      titles.add(item.title);
    }
  });
  return titles;
}

function alternativeFromIdea(stop, day, currency) {
  const pool = stop.type === "meal" ? MEAL_IDEAS : ACTIVITY_IDEAS;
  const used = usedTitles(day);
  const idea = pool.find((candidate) => !used.has(candidate.title)) || pool[Date.now() % pool.length];
  return {
    id: "alt-item-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
    type: stop.type === "meal" ? "meal" : "activity",
    title: idea.title,
    start: stop.start,
    end: stop.end,
    minutes: stop.minutes,
    place: "",
    address: day.city ? day.city + " (example idea)" : "Example idea",
    transit: null,
    tips: idea.tips,
    cost: idea.cost > 0 ? { amount: idea.cost, currency: (stop.cost && stop.cost.currency) || currency } : null,
    addedBy: null,
  };
}

export async function requestAlternative({ familyId, userId, stop, day, currency }) {
  if (USE_REAL_BACKEND && !USE_SAMPLE_PLAN) {
    const response = await fetch(
      `${API_BASE_URL}/families/${encodeURIComponent(familyId)}/plan/alternatives`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedBy: userId,
          dayNumber: day.dayNumber,
          itemId: stop.id,
          avoidTitles: Array.from(usedTitles(day)),
          startTime: stop.start,
          endTime: stop.end,
        }),
      }
    );
    if (response.status === 403) {
      throw new Error("Only people on this trip can split an event.");
    }
    if (!response.ok) {
      throw new Error("Could not find an alternative. Please try again.");
    }
    const raw = await response.json();
    return alternativeFromBackend(raw, stop, currency);
  }

  await new Promise((resolve) => setTimeout(resolve, 700));
  return alternativeFromIdea(stop, day, currency);
}