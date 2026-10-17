import { USE_REAL_BACKEND, API_BASE_URL } from "./config";

const KEY_PREFIX = "travelAppTravelProfile-";

function fakeKey(userId, familyId) {
  return `${KEY_PREFIX}${userId}-${familyId}`;
}

function realUrl(userId, familyId) {
  return (
    `${API_BASE_URL}/families/${encodeURIComponent(familyId)}` +
    `/members/${encodeURIComponent(userId)}/travel-profile`
  );
}

export async function saveTravelProfile(userId, familyId, travelProfile) {
  if (USE_REAL_BACKEND) {
    const response = await fetch(realUrl(userId, familyId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userTravelProfile: travelProfile }),
    });
    if (!response.ok) {
      throw new Error("Could not save your preferences. Please try again.");
    }
    return travelProfile;
  }

  localStorage.setItem(fakeKey(userId, familyId), JSON.stringify(travelProfile));
  return travelProfile;
}

export async function getTravelProfile(userId, familyId) {
  if (USE_REAL_BACKEND) {
    const response = await fetch(realUrl(userId, familyId));
    if (!response.ok) return null;
    const data = await response.json();
    return data.userTravelProfile || data;
  }

  const saved = localStorage.getItem(fakeKey(userId, familyId));
  return saved ? JSON.parse(saved) : null;
}

export function removeSavedTravelProfile(userId, familyId) {
  if (USE_REAL_BACKEND) return;
  localStorage.removeItem(fakeKey(userId, familyId));
}