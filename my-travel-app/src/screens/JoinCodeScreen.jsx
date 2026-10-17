

import { useState } from "react";
import { motion } from "framer-motion";
import { findTripByCode } from "../api/tripApi";
import "./ProfileScreen.css"; 
import "./SignUpScreen.css"; 
import "./JoinCodeScreen.css"; 
import Stamp from "../components/Stamp";
import { EiffelArt, ChapelArt, TajMahalArt } from "../components/stampArt";

function JoinCodeScreen({ onFound, onBack }) {
  // MEMORY (lives only while this screen is open)
  const [code, setCode] = useState("");
  const [error, setError] = useState(""); 
  const [busy, setBusy] = useState(false); 

  const codeOk = code.length === 4;


  async function handleFindClick() {
    if (!codeOk || busy) return;
    setBusy(true);
    setError("");
    try {
      // >>>>> DATA LEAVES HERE (the code goes to the backend)
      const trip = await findTripByCode(code);
      onFound(trip);
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  }

  return (
    <div className="join-page">
    <main className="profile join">
      {/* TOP ROW: back arrow (left) + three little decoration stamps (right) */}
      <div className="join-top">
        {/* BUTTON: back arrow.
            WHEN CLICKED: onBack() -> App.jsx goes back to Welcome.
            DATA SAVED: none. */}
        <button className="back-btn" onClick={onBack} aria-label="Go back">
          &larr;
        </button>

        {/* Decoration only. Nothing here is clickable or saved. */}
        <div className="join-stamps" aria-hidden="true">
          <Stamp color="var(--gold)" w={52} h={66} rot={-5}>
            <EiffelArt />
          </Stamp>
          <Stamp color="var(--ink)" fill="var(--teal)" w={52} h={66} rot={4}>
            <ChapelArt />
          </Stamp>
          <Stamp color="var(--pink)" w={52} h={66} rot={-3}>
            <TajMahalArt />
          </Stamp>
        </div>
      </div>

      <h1>Join a trip</h1>
      <p className="profile-sub">
        Ask the trip creator for their 4-digit family code.
      </p>

      {/* INPUT: the family code. Digits only, 4 long.
          DATA SAVED: none until "Find my trip" is clicked. */}
      <label className="field-label" htmlFor="family-code-input">
        Family code
      </label>
      <input
        id="family-code-input"
        className="code-input-big"
        value={code}
        maxLength={4}
        inputMode="numeric"
        placeholder="0000"
        autoComplete="off"
        onChange={(event) => {
          setCode(event.target.value.replace(/\D/g, ""));
          setError("");
        }}
      />

      {error && <p className="form-error">{error}</p>}


      <p className="join-hint">
        <strong>WHERE IS IT?</strong> The trip creator sees it on their
        "Your trip is ready" screen. Ask them to send it to you.
      </p>

      
      <motion.button
        className="btn-go"
        onClick={handleFindClick}
        disabled={!codeOk || busy}
        whileTap={{ scale: 0.96 }}
      >
    
      </motion.button>
    </main>
    </div>
  );
}

export default JoinCodeScreen;