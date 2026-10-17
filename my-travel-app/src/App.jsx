import { useState } from "react";
import CreateTripScreen from "./screens/CreateTripScreen";

function App() {
  const [destinationId, setDestinationId] = useState(null);
  const [sent, setSent] = useState("(nothing sent yet)");

  return (
    <>
      <CreateTripScreen
        selectedId={destinationId}
        onSelect={setDestinationId}
        onCreate={async (data) => {
          setSent(JSON.stringify({ destinationId, ...data }, null, 2));
        }}
        onBack={() => setSent("onBack() was called")}
      />
      {/* Testing note only. It is not part of the screen. */}
      <pre
        style={{
          position: "fixed",
          top: 8,
          right: 8,
          margin: 0,
          padding: "6px 10px",
          background: "#fff",
          color: "#000",
          fontSize: 12,
          zIndex: 99,
        }}
      >
        {sent}
      </pre>
    </>
  );
}

export default App;