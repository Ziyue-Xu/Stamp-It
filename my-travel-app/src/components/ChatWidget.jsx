import { useState, useEffect, useRef } from "react";
import { sendChatAnswer } from "../api/chatApi";
import "./ChatWidget.css";

function ChatIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect
        x="6"
        y="14"
        width="52"
        height="38"
        rx="5"
        fill="var(--ink)"
        stroke="var(--paper)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 18l24 18 24-18"
        fill="none"
        stroke="var(--paper)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function introText(profile) {
  const first = profile && profile.name ? profile.name.split(" ")[0] : "";
  const hello = first ? `Hi ${first}!` : "Hi there!";
  return `${hello} I'm your trip assistant. I'll ask a few quick yes or no questions to help plan your trip.`;
}

function toHistory(messages) {
  return messages.filter((m) => !m.local).map((m) => ({
    role: m.from === "me" ? "user" : "assistant",
    text: m.text,
  }));
}

function ChatWidget({ trip, profile }) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState(() => [
    { from: "agent", text: introText(profile), local: true },
  ]);
  const [expectsAnswer, setExpectsAnswer] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending, error, open]);

  async function send(answer, previous) {
    const withMine = answer
      ? [...previous, { from: "me", text: answer === "yes" ? "Yes" : "No" }]
      : previous;
    setMessages(withMine);
    setExpectsAnswer(false);
    setSending(true);
    setError("");
    try {
      const result = await sendChatAnswer({
        familyId: trip.familyId,
        userId: profile.userId,
        answer: answer,
        history: toHistory(previous),
      });
      setMessages([...withMine, { from: "agent", text: result.reply || "..." }]);
      setExpectsAnswer(result.expectsAnswer);
      setStarted(true);
    } catch (problem) {
      setMessages(previous);
      setExpectsAnswer(answer !== null);
      setError(problem.message);
    }
    setSending(false);
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && !started && !sending) {
      send(null, messages);
    }
  }

  function handleAnswer(answer) {
    if (sending) return;
    send(answer, messages);
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
            {error && !started && !sending && (
              <button type="button" className="chat-retry" onClick={() => send(null, messages)}>
                Try again
              </button>
            )}
          </div>

          {expectsAnswer && !sending && (
            <div className="chat-answers">
              <button type="button" className="chat-yes" onClick={() => handleAnswer("yes")}>
                Yes
              </button>
              <button type="button" className="chat-no" onClick={() => handleAnswer("no")}>
                No
              </button>
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        className="chat-fab"
        onClick={handleToggle}
        aria-label={open ? "Close chat" : "Open chat with the trip assistant"}
      >
        <ChatIcon />
      </button>
    </div>
  );
}

export default ChatWidget;