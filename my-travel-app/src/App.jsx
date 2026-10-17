import { AVATARS, findAvatar } from "./data/avatars";
import AvatarArt from "./components/AvatarArt";

// A small square that shows one avatar (the screens do the same thing).
function Chip({ avatar, size = 84 }) {
  return (
    <div
      className="avatar-fill"
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: avatar.background,
      }}
    >
      <AvatarArt id={avatar.id} />
    </div>
  );
}

function App() {
  const legacy = findAvatar("terracotta");
  const seeded = findAvatar(undefined, "user-1234");
  const seededAgain = findAvatar(undefined, "user-1234");

  return (
    <div style={{ padding: 32, fontFamily: "system-ui", lineHeight: 1.7 }}>
      <h1>Step 5 check</h1>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {AVATARS.map((avatar) => (
          <div key={avatar.id} style={{ textAlign: "center", fontSize: 13 }}>
            <Chip avatar={avatar} />
            {avatar.label}
          </div>
        ))}
      </div>

      <p><b>Old color id "terracotta" becomes:</b> {legacy.label} (should be Sagrada Familia)</p>
      <p>
        <b>No avatar, seed "user-1234":</b> {seeded.label}. Asked twice:{" "}
        {seededAgain.label} (same both times)
      </p>
    </div>
  );
}

export default App;