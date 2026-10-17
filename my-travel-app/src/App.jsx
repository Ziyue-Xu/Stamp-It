import { useState } from "react";
import SignUpScreen from "./screens/SignUpScreen";

function App() {
  const [note, setNote] = useState("(finish sign-up to see the result)");

  return (
    <>
      <SignUpScreen
        familyCode="4821"
        onSave={(profile) => setNote("onSave() called with: " + JSON.stringify(profile))}
        onBack={() => setNote("onBack() was called")}
      />
      {/* Testing note only. It is not part of the screen. */}
      <div
        style={{
          position: "fixed",
          top: 8,
          right: 8,
          maxWidth: 320,
          padding: "6px 10px",
          background: "#fff",
          color: "#000",
          fontSize: 12,
          fontFamily: "system-ui",
          zIndex: 99,
        }}
      >
        {note}
      </div>
    </>
  );
}

export default App;