import { useState } from "react";
import "./ReloadButton.css";

const MIN_SPIN_MS = 800;

function ReloadButton({ onReload }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const startedAt = Date.now();
    try {
      await onReload();
    } catch (problem) {
      setFailed(true);
    }
    const remaining = MIN_SPIN_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    setBusy(false);
  }

  const className =
    "reload-btn" + (busy ? " reload-btn-busy" : "") + (failed ? " reload-btn-failed" : "");

  return (
    <button
      className={className}
      onClick={handleClick}
      disabled={busy}
      aria-label={failed ? "Could not reload, tap to try again" : "Reload"}
      title={failed ? "Could not reload. Tap to try again." : "Reload"}
    >
      <span className="reload-icon" aria-hidden="true">&#8635;</span>
    </button>
  );
}

export default ReloadButton;