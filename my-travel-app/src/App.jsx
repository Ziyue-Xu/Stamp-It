import { useState } from "react";
import PreferencesScreen from "./screens/PreferencesScreen";
import { getTravelProfile } from "./api/preferencesApi";

const PROFILE = { userId: "test-user", name: "Mia", email: "mia@example.com", avatar: "taj" };
const TRIP = { familyId: "test-trip", destinationId: "japan" };

function App() {
  const [saved, setSaved] = useState(null);

  async function handleDone() {
    // read back what was saved, to prove it worked
    setSaved(await getTravelProfile(PROFILE.userId, TRIP.familyId));
  }

  if (saved) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Step 11 check: saved!</h1>
        <p>Each line is one question: its answer and its fixed priority.</p>
        <pre style={{ fontSize: 13 }}>{JSON.stringify(saved, null, 2)}</pre>
        <button onClick={() => setSaved(null)}>Try again</button>
      </div>
    );
  }

  return <PreferencesScreen profile={PROFILE} trip={TRIP} onDone={handleDone} />;
}

export default App;