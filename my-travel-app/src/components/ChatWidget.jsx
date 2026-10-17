import { useState, useRef, useEffect } from "react";
import { sendChatMessage } from "../api/chatApi";
import "./ChatWidget.css";

const GREETING = "Hi! Ask me anything about this trip.";

function ChatIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M10 14h44a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H30l-12 10V46h-8a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z"
        fill="#ffffff"
        stroke="#000000"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="30" r="3.2" fill="#000000" />
      <circle cx="32" cy="30" r="3.2" fill="#000000" />
      <circle cx="43" cy="30" r="3.2" fill="#000000" />
    </svg>
  );
}

function ChatWidget({ trip, profile }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([{ from: "agent", text: GREETING }]);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending, open]);

  async function handleSend(event) {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    const history = messages.map((m) => ({ role: m.from === "me" ? "user" : "assistant", text: m.text }));
    setMessages([...messages, { from: "me", text: message }]);
    setText("");
    setError("");
    setSending(true);
    try {
      const reply = await sendChatMessage({
        familyId: trip.familyId,
        userId: profile.userId,
        message: message,
        history: history,
      });
      setMessages((current) => [...current, { from: "agent", text: reply || "..." }]);
    } catch (problem) {
      setError(problem.message);
    }
    setSending(false);
  }

  return (
    <div className="chat">
      {open && (
        <section className="chat-panel" aria-label="Trip assistant chat">
          <header className="chat-head">
            <span className="chat-title">Your Personal Agent</span>
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
          </div>

          <form className="chat-form" onSubmit={handleSend}>
            <input
              className="chat-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message"
              aria-label="Type a message"
            />
            <button type="submit" className="chat-send" disabled={sending || !text.trim()}>
              Send
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="chat-fab"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close chat" : "Open chat with the trip assistant"}
      >
        <ChatIcon />
      </button>
    </div>
  );
}

export default ChatWidget;