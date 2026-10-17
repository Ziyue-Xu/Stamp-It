

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
    // storage blocked: the plan still shows, it just won't be remembered
  }
}

function readSavedPlan(familyId) {
  try {
    const text = localStorage.getItem(SAVED_PLAN_KEY + familyId);
    return text ? JSON.parse(text) : null;
  } catch (problem) {
    return null; // storage blocked or the text was damaged: ignore it
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
  writeSavedPlan(familyId, fresh); // replaces the edited copy with the original
  return { plan: fresh };
}