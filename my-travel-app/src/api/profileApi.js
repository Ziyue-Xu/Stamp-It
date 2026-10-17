
import { USE_REAL_BACKEND, API_BASE_URL } from "./config";

const PROFILE_KEY = "travelAppProfile";


export async function getProfile() {

  const saved = localStorage.getItem(PROFILE_KEY);
  return saved ? JSON.parse(saved) : null;

 
}


export async function saveProfile(profile) {

  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;


}


export async function clearProfile() {
  localStorage.removeItem(PROFILE_KEY);
}

export async function updateProfile(userId, changes) {
  if (USE_REAL_BACKEND) {
    // ===== REAL BRANCH: send the new name to the backend =====
    const response = await fetch(
      `${API_BASE_URL}/users/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: changes.name }),
      }
    );
    if (!response.ok) {
      throw new Error("Could not save your changes. Please try again.");
    }
  }


  const current = await getProfile();
  const updated = { ...current, ...changes };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
  return updated;
}