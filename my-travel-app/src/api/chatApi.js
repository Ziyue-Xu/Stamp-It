import { API_BASE_URL } from "./config";

const USE_SAMPLE_CHAT = false;

function chatPath(familyId) {
  return `/families/${encodeURIComponent(familyId)}/chat`;
}

function buildBody({ userId, answer, history }) {
  return { userId: userId, answer: answer, history: history };
}

function readReply(data) {
  return data.reply || data.message || data.question || data.text || "";
}

function readExpectsAnswer(data) {
  if (data.expectsAnswer !== undefined) return Boolean(data.expectsAnswer);
  if (data.expects_answer !== undefined) return Boolean(data.expects_answer);
  if (data.done !== undefined) return !data.done;
  return true;
}

const SAMPLE_QUESTIONS = [
  "Hi! Quick question: should I plan a relaxed morning on day 2?",
  "Would your group like a food tour in the evening?",
  "Should I keep the budget on the lower side?",
];

export async function sendChatAnswer({ familyId, userId, answer, history }) {
  if (!USE_SAMPLE_CHAT) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${chatPath(familyId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody({ userId, answer, history })),
      });
    } catch (problem) {
      throw new Error("Could not reach the assistant. Check your connection and try again.");
    }
    if (response.status === 403) {
      throw new Error("Only people on this trip can use the assistant.");
    }
    if (response.status === 404) {
      throw new Error("The assistant isn't available for this trip yet.");
    }
    if (!response.ok) {
      throw new Error("The assistant could not answer. Please try again.");
    }
    const data = await response.json();
    return {
      reply: readReply(data),
      expectsAnswer: readExpectsAnswer(data),
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 700));
  const answered = history.filter((item) => item.role === "user").length + (answer ? 1 : 0);
  if (answered < SAMPLE_QUESTIONS.length) {
    return { reply: SAMPLE_QUESTIONS[answered], expectsAnswer: true };
  }
  return { reply: "Thanks! I've noted your answers.", expectsAnswer: false };
}