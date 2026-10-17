import { useState } from "react";
import WelcomeScreen from "./screens/WelcomeScreen";

function App() {
  const [message, setMessage] = useState("(click a button)");

  return (
    <>
      <WelcomeScreen
        onStartTrip={() => setMessage("onStartTrip() was called")}
        onJoinTrip={() => setMessage("onJoinTrip() was called")}
      />
      {/* This little note is only for testing. It is not part of the screen. */}
      <div
        style={{
          position: "fixed",
          top: 8,
          left: 8,
          padding: "4px 10px",
          background: "#fff",
          color: "#000",
          fontSize: 13,
          fontFamily: "system-ui",
          zIndex: 99,
        }}
      >
        {message}
      </div>
    </>
  );
}

export default App;