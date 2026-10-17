import { USE_REAL_BACKEND, API_BASE_URL } from "./config";

const USE_SAMPLE_CHAT = true;

export async function sendChatMessage({ familyId, userId, message, history }) {
  if (USE_REAL_BACKEND && !USE_SAMPLE_CHAT) {
    const response = await fetch(
      `${API_BASE_URL}/families/${encodeURIComponent(familyId)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId, message: message, history: history }),
      }
    );
    if (response.status === 403) {
      throw new Error("Only people on this trip can chat with the assistant.");
    }
    if (!response.ok) {
      throw new Error("The assistant could not answer. Please try again.");
    }
    const data = await response.json();
    return data.reply || data.message || "";
  }

  await new Promise((resolve) => setTimeout(resolve, 900));
  return "Hi! I'm a placeholder for the trip assistant. Once the AI agent is connected, I'll answer here.";
}