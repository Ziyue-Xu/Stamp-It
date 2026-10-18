import { useState, useEffect, useRef, useCallback } from "react";
import {
  createNegotiationRequest,
  getNegotiationStatus,
  respondToNegotiationRequest,
  startNegotiationSession,
} from "../api/chatApi";
import "./ChatWidget.css";

const PREFERENCE_LABELS = {
  activityFocus: "activities",
  activityPopularity: "attraction popularity",
  attractionPopularity: "attraction popularity",
  budgetTier: "budget",
  dietaryRestrictions: "dietary needs",
  diningCuisine: "dining style",
  groundTransportation: "getting around",
  interestedInShopping: "shopping",
  luggagePreference: "luggage",
  morningRoutine: "morning start",
  petFriendly: "pet-friendly places",
  tripPace: "daily pace",
  tourPreference: "guided tours",
  travelStyle: "travel style",
};

function preferenceLabel(preference) {
  if (PREFERENCE_LABELS[preference]) return PREFERENCE_LABELS[preference];
  const words = String(preference)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M10 14h44a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H30l-12 10V46h-8a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z"
        fill="var(--ink)"
        stroke="var(--paper)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="30" r="3.2" fill="var(--paper)" />
      <circle cx="32" cy="30" r="3.2" fill="var(--paper)" />
      <circle cx="43" cy="30" r="3.2" fill="var(--paper)" />
    </svg>
  );
}

function describeValue(value) {
  if (value === null || value === undefined) return "no preference";
  if (Array.isArray(value)) return value.map(describeValue).join(", ");
  if (value && typeof value === "object") {
    if ("value" in value) return describeValue(value.value);
    return Object.values(value).map(describeValue).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  }
  return String(value);
}

function questionForRequest(request) {
  return [
    request.question,
    `Suggested change to your ${preferenceLabel(request.preference)}: ${describeValue(request.currentValue)} → ${describeValue(request.proposedValue)}.`,
  ].join("\n\n");
}

function ChatWidget({ trip, profile }) {
  const key = `${trip?.familyId || ""}:${profile?.userId || ""}`;
  return <ChatWidgetSession key={key} trip={trip} profile={profile} />;
}

function ChatWidgetSession({ trip, profile }) {
  const [open, setOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState("loading");
  const [consentDismissed, setConsentDismissed] = useState(false);
  const [messages, setMessages] = useState([]);
  const [activeRequest, setActiveRequest] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const activeRequestRef = useRef(null);
  const loadingRef = useRef(false);
  const respondingRef = useRef(false);
  const seenMessagesRef = useRef(new Set());
  const attemptedTargetsRef = useRef(new Set());
  const familyId = trip?.familyId;
  const userId = profile?.userId;

  const addAgentMessage = useCallback((key, text) => {
    if (seenMessagesRef.current.has(key)) return;
    seenMessagesRef.current.add(key);
    setMessages((current) => [...current, { from: "agent", text }]);
  }, []);

  const applyStatus = useCallback(
    (status) => {
      setSessionStatus(status.sessionStatus || "awaiting_consent");
      const requests = Array.isArray(status.requests) ? status.requests : [];
      const sessionRequests = status.sessionId
        ? requests.filter((request) => request.sessionId === status.sessionId)
        : [];
      const incoming = sessionRequests.find(
        (request) =>
          request.status === "pending" && request.targetUserId === userId
      );
      if (incoming) {
        activeRequestRef.current = incoming;
        setActiveRequest(incoming);
        addAgentMessage(
          `question:${incoming.requestId}`,
          questionForRequest(incoming)
        );
        return;
      }

      activeRequestRef.current = null;
      setActiveRequest(null);
    },
    [addAgentMessage, userId]
  );

  const syncStatus = useCallback(
    async () => {
      if (!familyId || !userId || loadingRef.current || respondingRef.current) return;
      loadingRef.current = true;
      setSending(true);
      setError("");
      let startingPreference = null;
      try {
        const status = await getNegotiationStatus(familyId);
        applyStatus(status);
        if (status.sessionStatus === "awaiting_consent") {
          addAgentMessage(
            "balancing-introduction",
            "Would you like me to start making suggestions to balance your travel preferences?"
          );
          return;
        }
        if (status.sessionStatus === "completed" || status.balanced) {
          addAgentMessage(
            `balancing-complete:${status.sessionId}`,
            "Your preferences are all balanced. I’m ending the balancing now."
          );
          return;
        }
        if (status.sessionStatus === "limit_reached" || status.questionLimitReached) {
          addAgentMessage(
            `question-limit-reached:${status.sessionId}`,
            "We’ve reached the family’s question limit, so I’m ending the balancing now."
          );
          return;
        }
        if (status.sessionStatus !== "active") return;
        for (const conflict of status.conflicts || []) {
          if (conflict.resolution === "split") {
            addAgentMessage(
              `compromise:${conflict.preference}`,
              `For ${preferenceLabel(conflict.preference)}, I’ll balance both preferences in the itinerary rather than ask anyone to change their answer.`
            );
          }
        }

        const requests = (status.requests || []).filter(
          (request) => request.sessionId === status.sessionId
        );
        if (requests.some((request) => request.status === "pending")) return;

        const nextQuestion = (status.conflicts || [])
          .filter(
            (item) =>
              item.resolution === "negotiate" &&
              !status.resolvedPreferences?.[item.preference]
          )
          .map((conflict) => {
            if (!conflict.users?.some((user) => user.userId === userId)) return null;
            const target = conflict.users.find((user) => {
              if (user.userId === userId) return false;
              const key = `${conflict.preference}:${user.userId}`;
              return (
                !attemptedTargetsRef.current.has(key) &&
                !(status.requests || []).some(
                  (request) =>
                    request.preference === conflict.preference &&
                    request.targetUserId === user.userId
                )
              );
            });
            return target ? { conflict, target } : null;
          })
          .find(Boolean);
        if (!nextQuestion) {
          addAgentMessage(
            "waiting-for-other-travelers",
            "I’ll let you know when I have a suggestion for you."
          );
          return;
        }

        const { conflict, target } = nextQuestion;
        startingPreference = `${conflict.preference}:${target.userId}`;
        attemptedTargetsRef.current.add(startingPreference);
        const created = await createNegotiationRequest({
          familyId,
          preference: conflict.preference,
          targetUserId: target.userId,
          idempotencyKey: crypto.randomUUID(),
        });
        if (created.status === "created" || created.status === "existing") {
          const request = created.request;
          if (request.targetUserId === userId) {
            activeRequestRef.current = request;
            setActiveRequest(request);
            addAgentMessage(
              `question:${request.requestId}`,
              questionForRequest(request)
            );
          }
        } else if (created.status === "recommended") {
          const recommendation = {
            recommend_split: "We can split the day to make room for both preferences.",
            accommodate: "I recommend honoring the more important preference.",
            review: "This one needs a closer look before we can suggest a change.",
          }[created.action] || "I found another way to balance this preference.";
          addAgentMessage(
            `recommendation:${conflict.preference}`,
            `For ${preferenceLabel(conflict.preference)}, ${recommendation} ${created.rationale}`
          );
        } else if (created.status === "generating") {
          return;
        } else {
          throw new Error("The negotiation service returned an unknown result.");
        }
      } catch (problem) {
        if (startingPreference && problem.status !== 409) {
          attemptedTargetsRef.current.delete(startingPreference);
        }
        if (problem.status === 409) {
          try {
            const latest = await getNegotiationStatus(familyId);
            applyStatus(latest);
          } catch (refreshError) {
            setError(refreshError.message);
          }
        } else {
          setError(problem.message);
        }
      } finally {
        loadingRef.current = false;
        setSending(false);
      }
    },
    [addAgentMessage, applyStatus, familyId, userId]
  );

  useEffect(() => {
    if (!open || !familyId || !userId) return undefined;
    const initialCheck = window.setTimeout(() => {
      void syncStatus();
    }, 0);
    const interval = window.setInterval(() => {
      void syncStatus();
    }, 10_000);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
    };
  }, [familyId, open, syncStatus, userId]);

  async function handleStartSession() {
    if (!familyId || sending) return;
    setSending(true);
    setError("");
    try {
      const status = await startNegotiationSession(familyId);
      attemptedTargetsRef.current.clear();
      setConsentDismissed(false);
      applyStatus(status);
      addAgentMessage(
        `session-started:${status.sessionId}`,
        "I’ll start looking for preference suggestions now."
      );
      window.setTimeout(() => void syncStatus(), 0);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setSending(false);
    }
  }

  function handleDeclineSession() {
    setConsentDismissed(true);
    setMessages((current) => [
      ...current,
      { from: "me", text: "Not now" },
      { from: "agent", text: "No problem. I’ll wait until you’re ready." },
    ]);
  }

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending, error, open]);

  async function handleAnswer(answer) {
    const request = activeRequestRef.current;
    if (!request || respondingRef.current) return;
    const previousMessages = messages;
    const answerText = answer === "accept" ? "Yes" : "No";
    setMessages([...previousMessages, { from: "me", text: answerText }]);
    activeRequestRef.current = null;
    setActiveRequest(null);
    respondingRef.current = true;
    setSending(true);
    setError("");
    try {
      await respondToNegotiationRequest({
        familyId,
        requestId: request.requestId,
        answer,
      });
      setMessages((current) => [
        ...current,
        {
          from: "agent",
          text:
            answer === "accept"
                ? "Thanks, I recorded your agreement and updated that part of your travel preferences."
              : "Thanks, I recorded your response. I’ll look for another compromise.",
        },
      ]);
    } catch (problem) {
      setMessages(previousMessages);
      activeRequestRef.current = request;
      setActiveRequest(request);
      setError(problem.message);
    } finally {
      respondingRef.current = false;
      setSending(false);
    }
  }

  function handleToggle() {
    setOpen((current) => !current);
  }

  return (
    <div className="chat">
      {open && (
        <section className="chat-panel" aria-label="Trip assistant">
          <header className="chat-head">
            <span className="chat-title">Trip assistant</span>
            <button
              type="button"
              className="chat-close"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              &times;
            </button>
          </header>

          <div className="chat-list" ref={listRef}>
            {messages.map((m, index) => (
              <div className={"chat-row chat-row-" + m.from} key={index}>
                <div className="chat-bubble">{m.text}</div>
              </div>
            ))}
            {sending && (
              <div className="chat-row chat-row-agent">
                <div className="chat-bubble chat-typing">Thinking...</div>
              </div>
            )}
            {error && <p className="chat-error">{error}</p>}
            {error && !sending && (
              <button
                type="button"
                className="chat-retry"
                onClick={() => void syncStatus()}
              >
                Try again
              </button>
            )}
          </div>

          {activeRequest && !sending && (
            <div className="chat-answers">
              <button
                type="button"
                className="chat-yes"
                onClick={() => void handleAnswer("accept")}
              >
                Yes
              </button>
              <button
                type="button"
                className="chat-no"
                onClick={() => void handleAnswer("reject")}
              >
                No
              </button>
            </div>
          )}
          {sessionStatus === "awaiting_consent" && !consentDismissed && !sending && (
            <div className="chat-answers">
              <button
                type="button"
                className="chat-yes"
                onClick={() => void handleStartSession()}
              >
                Yes, start
              </button>
              <button
                type="button"
                className="chat-no"
                onClick={handleDeclineSession}
              >
                Not now
              </button>
            </div>
          )}
          {(sessionStatus === "completed" || sessionStatus === "limit_reached") &&
            !sending && (
              <div className="chat-answers">
                <button
                  type="button"
                  className="chat-yes"
                  onClick={() => void handleStartSession()}
                >
                  Start a new session
                </button>
              </div>
            )}
        </section>
      )}

      <button
        type="button"
        className="chat-fab"
        onClick={handleToggle}
        aria-label={open ? "Close chat" : "Open chat with the trip preference agent"}
      >
        <ChatIcon />
      </button>
    </div>
  );
}

export default ChatWidget;