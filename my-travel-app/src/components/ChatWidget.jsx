import { useState, useEffect, useRef, useCallback } from "react";
import {
  createNegotiationRequest,
  getNegotiationStatus,
  respondToNegotiationRequest,
  startNegotiationSession,
} from "../api/chatApi";
import "./ChatWidget.css";

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
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") {
    if ("value" in value) return describeValue(value.value);
    return JSON.stringify(value);
  }
  return String(value);
}

function questionForRequest(request) {
  return [
    request.question,
    `Suggested change: ${describeValue(request.currentValue)} → ${describeValue(request.proposedValue)}.`,
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
  const requestStatusesRef = useRef(new Map());
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
      for (const request of requests) {
        const previousStatus = requestStatusesRef.current.get(request.requestId);
        if (
          previousStatus === "pending" &&
          request.status !== "pending" &&
          request.requesterUserId === userId
        ) {
          const answer =
            request.status === "accepted" ? "accepted" : "declined";
          addAgentMessage(
            `answered:${request.requestId}`,
            `${request.targetName} ${answer} the suggested change. The agent is checking whether another compromise could help.`
          );
        }
        requestStatusesRef.current.set(request.requestId, request.status);
      }

      const sessionRequests = status.sessionId
        ? requests.filter((request) => request.sessionId === status.sessionId)
        : [];
      const pending = sessionRequests.filter(
        (request) =>
          request.status === "pending"
      );
      const incoming = pending.find((request) => request.targetUserId === userId);
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

      const outgoing = pending.find(
        (request) => request.requesterUserId === userId
      );
      if (outgoing) {
        addAgentMessage(
          `waiting:${outgoing.requestId}`,
          `I asked ${outgoing.targetName}: “${outgoing.question}” I’ll let you know when they respond.`
        );
        return;
      }

      if (pending.length > 0) {
        addAgentMessage(
          `other-pending:${pending[0].requestId}`,
          "A family member is considering a preference change. I’ll update this chat when there’s a response."
        );
        return;
      }

      if (sessionRequests.length > 0) {
        const latest = sessionRequests[sessionRequests.length - 1];
        const response =
          latest.status === "accepted"
            ? "The last suggested change was accepted."
            : latest.status === "rejected"
              ? "The last suggested change was declined."
              : "The last request is no longer active.";
        addAgentMessage(
          `latest:${latest.requestId}:${latest.status}`,
          `${response} I’m checking whether another compromise could help.`
        );
      }
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
              `For ${conflict.preference}, I’ll balance both preferences in the itinerary rather than ask anyone to change their answer.`
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
            "I don’t have another eligible traveler to ask right now. I’ll check again as the group continues."
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
          activeRequestRef.current = request;
          setActiveRequest(request);
          requestStatusesRef.current.set(request.requestId, request.status);
          addAgentMessage(
            `question:${request.requestId}`,
            questionForRequest(request)
          );
        } else if (created.status === "recommended") {
          addAgentMessage(
            `recommendation:${conflict.preference}`,
            `For ${conflict.preference}, I recommend ${created.action}. ${created.rationale}`
          );
        } else if (created.status === "generating") {
          addAgentMessage(
            `generating:${created.requestId}`,
            "I’m preparing a preference question. Please reopen the chat in a moment."
          );
        } else {
          throw new Error("The negotiation service returned an unknown result.");
        }
      } catch (problem) {
        if (
          startingPreference &&
          !(problem.status === 409 && /already pending/iu.test(problem.message))
        ) {
          attemptedTargetsRef.current.delete(startingPreference);
        }
        if (problem.status === 409 && /already pending/iu.test(problem.message)) {
          try {
            const latest = await getNegotiationStatus(familyId);
            applyStatus(latest);
            if (!(latest.requests || []).some((request) => request.status === "pending")) {
              setError(problem.message);
            }
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
      const result = await respondToNegotiationRequest({
        familyId,
        requestId: request.requestId,
        answer,
      });
      requestStatusesRef.current.set(request.requestId, result.request.status);
      setMessages((current) => [
        ...current,
        {
          from: "agent",
          text:
            answer === "accept"
              ? "Thanks, I recorded your agreement and updated your preference."
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