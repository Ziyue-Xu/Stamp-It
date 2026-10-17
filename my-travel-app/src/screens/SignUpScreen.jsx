
import { useState } from "react";
import { motion } from "framer-motion";
import { AVATARS, findAvatar } from "../data/avatars";
import AvatarArt from "../components/AvatarArt";
import { startSignIn, verifyCode, FAKE_CODE } from "../api/authApi";
import { USE_REAL_BACKEND } from "../api/config";
import "./ProfileScreen.css"; // shared styles (pass card, inputs, buttons)
import "./SignUpScreen.css"; // shared styles (other screens still use these)
import "./SignUpStamp.css"; // this screen's stamp-style looks (NEW file)
import Stamp from "../components/Stamp";
import { LibertyArt, FujiArt, ChapelArt } from "../components/stampArt";


function TopRow({ onBackClick, backLabel }) {
  return (
    <div className="signup-top">
      <button className="back-btn" onClick={onBackClick} aria-label={backLabel}>
        &larr;
      </button>
      <div className="signup-stamps" aria-hidden="true">
        <Stamp color="var(--gold)" w={52} h={66} rot={-5}>
          <LibertyArt />
        </Stamp>
        <Stamp color="var(--ink)" fill="var(--pink)" w={52} h={66} rot={4}>
          <FujiArt />
        </Stamp>
        <Stamp color="var(--ink)" fill="var(--teal)" w={52} h={66} rot={-3}>
          <ChapelArt />
        </Stamp>
      </div>
    </div>
  );
}

function SignUpScreen({ onSave, onBack, familyCode}) {

  const [step, setStep] = useState("details"); // "details" or "code"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarId, setAvatarId] = useState("taj");
  const [code, setCode] = useState("");
  const [error, setError] = useState(""); // red message, "" = none
  const [notice, setNotice] = useState(""); // friendly message, "" = none
  const [busy, setBusy] = useState(false); // true while waiting on a request

  const avatar = findAvatar(avatarId);
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();


  const nameOk = trimmedName.length > 0 && trimmedName.length <= 80;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail);
  const codeOk = code.length === 4;


  async function handleSendCodeClick() {
    if (!nameOk || !emailOk || busy) return;
    setBusy(true);
    setError("");
    try {

      await startSignIn({ name: trimmedName, email: trimmedEmail });
      setStep("code");
    } catch (problem) {
      setError(problem.message);
    }
    setBusy(false);
  }


  async function handleVerifyClick() {
    if (!codeOk || busy) return;
    setBusy(true);
    setError("");
    try {

      const account = await verifyCode({
        name: trimmedName,
        email: trimmedEmail,
        code: code,
        familyCode: familyCode,
      });
      onSave({
        userId: account.userId,
        name: account.name,
        email: account.email,
        avatar: avatarId,
      });
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  }


  async function handleResendClick() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {

      await startSignIn({ name: trimmedName, email: trimmedEmail });
      setNotice("New code sent. Check your email.");
    } catch (problem) {
      setError(problem.message);
    }
    setBusy(false);
  }


  if (step === "code") {
    return (
      <div className="signup-page">
      <main className="profile signup">

        <TopRow
          onBackClick={() => {
            setStep("details");
            setCode("");
            setError("");
            setNotice("");
          }}
          backLabel="Back to details"
        />

        <div className="signup-step">STEP 2 OF 2</div>
        <h1>Check your email</h1>
        <p className="profile-sub">
          We sent a 4-digit code to <strong>{trimmedEmail}</strong>. It expires in 5 minutes.
        </p>


        {!USE_REAL_BACKEND && (
          <p className="test-note">Test mode: the code is {FAKE_CODE}</p>
        )}

    
        <label className="field-label" htmlFor="code-input">
          Your code
        </label>
        <input
          id="code-input"
          className="code-input-big"
          value={code}
          maxLength={4}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="0000"
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        />

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-note">{notice}</p>}


        <button className="link-btn" onClick={handleResendClick} disabled={busy}>
          Didn't get it? Send a new code
        </button>


        <motion.button
          className="btn-go"
          onClick={handleVerifyClick}
          disabled={!codeOk || busy}
          whileTap={{ scale: 0.96 }}
        >
          {busy ? "Checking..." : "Verify"}
        </motion.button>
      </main>
      </div>
    );
  }


  return (
    <div className="signup-page">
    <main className="profile signup">

      <TopRow onBackClick={onBack} backLabel="Go back" />

      <div className="signup-step">STEP 1 OF 2</div>
      <h1>Let's get you on board</h1>
      <p className="profile-sub">
        We'll email you a 4-digit code. No password needed.
      </p>


      <section className="pass" aria-hidden="true">
        <div className="pass-label">TRAVEL PASS</div>
        <div className="pass-body">
          <motion.div
            key={avatar.id}
            className="pass-avatar avatar-fill"
            style={{ background: avatar.background }}
            initial={{ scale: 0.7 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 14 }}
          >
            <AvatarArt id={avatar.id} />
          </motion.div>
          <div className="pass-name">{trimmedName || "Your name"}</div>
        </div>
        <div className="pass-stripe"></div>
      </section>


      <label className="field-label" htmlFor="name-input">
        Your name
      </label>
      <input
        id="name-input"
        className="name-input"
        value={name}
        maxLength={80}
        placeholder="Mia"
        onChange={(event) => setName(event.target.value)}
      />

      <label className="field-label" htmlFor="email-input">
        Your email
      </label>
      <input
        id="email-input"
        className="name-input"
        type="email"
        value={email}
        placeholder="mia@example.com"
        autoComplete="email"
        onChange={(event) => setEmail(event.target.value)}
      />

      <p className="field-label">Pick your avatar</p>
      <div className="swatch-row" style={{ flexWrap: "wrap" }}>
        {AVATARS.map((choice) => (
          <motion.button
            key={choice.id}
            className={
              "swatch avatar-fill" + (choice.id === avatarId ? " swatch-selected" : "")
            }
            style={{ background: choice.background, width: 54, height: 54 }}
            aria-label={choice.label}
            aria-pressed={choice.id === avatarId}
            onClick={() => setAvatarId(choice.id)}
            whileTap={{ scale: 0.9 }}
          >
            <AvatarArt id={choice.id} />
          </motion.button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}


      <motion.button
        className="btn-go"
        onClick={handleSendCodeClick}
        disabled={!nameOk || !emailOk || busy}
        whileTap={{ scale: 0.96 }}
      >
        {busy ? "Sending..." : "Send me a code"}
      </motion.button>
    </main>
    </div>
  );
}

export default SignUpScreen;