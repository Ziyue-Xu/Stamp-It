

import { USE_REAL_BACKEND, API_BASE_URL } from "./config";
import { planFromBackend } from "./planFormat";
import sampleTrip from "../data/sampleTrip.json";


const USE_SAMPLE_PLAN = false;


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
    return { plan: planFromBackend(data) };
  }


  return { plan: { ...planFromBackend(sampleTrip), isSample: true } };
}