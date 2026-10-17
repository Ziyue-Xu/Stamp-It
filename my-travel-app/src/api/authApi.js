

import { USE_REAL_BACKEND, API_BASE_URL } from "./config";


export const FAKE_CODE = "1234";


async function readErrorMessage(response, fallback) {
  try {
    const data = await response.json();
    return data.error || data.message || fallback;
  } catch (error) {
    return fallback;
  }
}


export async function startSignIn({ name, email }) {
  if (USE_REAL_BACKEND) {
    // ===== REAL BRANCH =====
    const response = await fetch(`${API_BASE_URL}/auth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    if (!response.ok) {
      throw new Error(
        await readErrorMessage(response, "Could not send the code. Check your email and try again.")
      );
    }
    return;
  }

  // ===== FAKE BRANCH: nothing is sent =====
  console.log(`FAKE MODE: no email sent. The code is ${FAKE_CODE}`);
}


export async function verifyCode({ name, email, code, familyCode }) {
  if (USE_REAL_BACKEND) {
    // ===== REAL BRANCH =====
    const response = await fetch(`${API_BASE_URL}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, familyCode }),
    });
    if (!response.ok) {
      throw new Error(
        await readErrorMessage(response, "That code is incorrect or expired.")
      );
    }
    const data = await response.json();
    return { userId: data.userId, name: data.name, email: data.email };
  }

  if (code !== FAKE_CODE) {
    throw new Error("That code is incorrect or expired.");
  }
  
  return { userId: "fake-user-" + email.toLowerCase(), name: name || email.split("@")[0], email };
}