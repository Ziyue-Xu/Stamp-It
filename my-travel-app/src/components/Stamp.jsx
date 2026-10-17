
import "./Stamp.css";

export default function Stamp({
  color = "var(--pink)",
  fill,
  shape = "rect",
  w = 120,
  h = 150,
  x = 0,
  y = 0,
  rot = 0,
  depth = 0.5,
  delay = 0,
  placed = false,
  animate = true,
  children,
}) {
  const frame = (
    <div
      className={`stamp stamp-${shape}`}
      style={{
        width: w,
        height: h,
        "--c": color,
        "--fill": fill || color,
      }}
    >
      {children}
    </div>
  );

  
  if (!placed) {
    return (
      <div style={{ transform: `rotate(${rot}deg)`, display: "inline-block" }}>
        {frame}
      </div>
    );
  }

  
  return (
    <div className="stamp-pos" style={{ left: x, top: y, "--depth": depth }}>
      <div
        className={animate ? "stamp-in" : undefined}
        style={{ "--rot": `${rot}deg`, "--delay": `${delay}s`, transform: `rotate(${rot}deg)` }}
      >
        <div className="stamp-bob" style={{ "--bob": `${(delay * 1.7).toFixed(2)}s` }}>
          {frame}
        </div>
      </div>
    </div>
  );
}