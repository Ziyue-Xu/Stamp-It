import { USE_REAL_BACKEND, API_BASE_URL } from "./config";

const USE_SAMPLE_CHAT = true;

const SAMPLE_QUESTIONS = [
  "Hi! Quick question: should I plan a relaxed morning on day 2?",
  "Would your group like a food tour in the evening?",
  "Should I keep the budget on the lower side?",
];

export async function sendChatAnswer({ familyId, userId, answer, history }) {
  if (USE_REAL_BACKEND && !USE_SAMPLE_CHAT) {
    const response = await fetch(
      `${API_BASE_URL}/families/${encodeURIComponent(familyId)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId, answer: answer, history: history }),
      }
    );
    if (response.status === 403) {
      throw new Error("Only people on this trip can use the assistant.");
    }
    if (!response.ok) {
      throw new Error("The assistant could not answer. Please try again.");
    }
    const data = await response.json();
    return {
      reply: data.reply || data.message || "",
      expectsAnswer: data.expectsAnswer !== false,
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 700));
  const answered = history.filter((item) => item.role === "user").length + (answer ? 1 : 0);
  if (answered < SAMPLE_QUESTIONS.length) {
    return { reply: SAMPLE_QUESTIONS[answered], expectsAnswer: true };
  }
  return { reply: "Thanks! I've noted your answers.", expectsAnswer: false };
}