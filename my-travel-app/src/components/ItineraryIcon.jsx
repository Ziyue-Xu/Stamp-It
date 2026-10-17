import "./ItineraryIcon.css";

const INK = "var(--ink)";

function ItineraryIcon() {
  return (
    <span className="itin-icon" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <path
          d="M8 14l16-4 16 4 16-4v40l-16 4-16-4-16 4z"
          fill="var(--gold)"
          stroke={INK}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M24 10v40M40 14v40" stroke={INK} strokeWidth="3" />
        <path
          d="M14 44c6-10 12 2 18-8s10-4 16-14"
          fill="none"
          stroke="var(--terracotta)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="1 7"
        />
        <path
          d="M44 16l8 8M52 16l-8 8"
          stroke="var(--terracotta)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export default ItineraryIcon;