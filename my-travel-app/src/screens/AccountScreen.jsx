

import { useState } from "react";
import { motion } from "framer-motion";
import { AVATARS, findAvatar } from "../data/avatars";
import AvatarArt from "../components/AvatarArt";
import "./ProfileScreen.css";
import "./SignUpScreen.css"; 
import "./AccountScreen.css";
import Stamp from "../components/Stamp";
import { TajMahalArt, EiffelArt } from "../components/stampArt";

function AccountScreen({ profile, onSave, onBack, onSignOut }) {

  const [name, setName] = useState(profile.name);

  const savedAvatarId = findAvatar(profile.avatar, profile.userId).id;
  const [avatarId, setAvatarId] = useState(savedAvatarId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const avatar = findAvatar(avatarId);
  const trimmedName = name.trim();
  const nameOk = trimmedName.length > 0 && trimmedName.length <= 80;


  const changed = trimmedName !== profile.name || avatarId !== savedAvatarId;


  async function handleSaveClick() {
    if (!nameOk || !changed || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {

      await onSave({ name: trimmedName, avatar: avatarId });
      setNotice("Saved!");
    } catch (problem) {
      setError(problem.message);
    }
    setBusy(false);
  }

  return (
    <div className="account-page">
    <main className="profile account">

      <div className="account-top">

        <button className="back-btn" onClick={onBack} aria-label="Back to my trips">
          &larr;
        </button>
        <div className="account-stamps" aria-hidden="true">
          <Stamp color="var(--pink)" w={52} h={66} rot={-4}>
            <TajMahalArt />
          </Stamp>
          <Stamp color="var(--ink)" fill="var(--gold)" w={52} h={66} rot={4}>
            <EiffelArt />
          </Stamp>
        </div>
      </div>


      <div
        className="account-avatar avatar-fill"
        style={{ background: avatar.background }}
        aria-hidden="true"
      >
        <AvatarArt id={avatar.id} />
      </div>
      <h1 className="account-title">Your profile</h1>


      <label className="field-label" htmlFor="account-name">
        Name
      </label>
      <input
        id="account-name"
        className="name-input"
        value={name}
        maxLength={80}
        onChange={(event) => {
          setName(event.target.value);
          setNotice("");
        }}
      />

      <p className="field-label">Email</p>
      <div className="account-email">
        <span className="account-email-text">{profile.email}</span>
        <span className="verified-chip">Verified</span>
      </div>
      <p className="account-note">
        Your email is verified, so it can't be changed here.
      </p>


      <p className="field-label">Your avatar</p>
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
            onClick={() => {
              setAvatarId(choice.id);
              setNotice("");
            }}
            whileTap={{ scale: 0.9 }}
          >
            <AvatarArt id={choice.id} />
          </motion.button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-note">{notice}</p>}


      <motion.button
        className="btn-go account-save"
        onClick={handleSaveClick}
        disabled={!nameOk || !changed || busy}
        whileTap={{ scale: 0.96 }}
      >
        {busy ? "Saving..." : "Save changes"}
      </motion.button>


      <button className="link-btn account-signout" onClick={onSignOut}>
        Sign out
      </button>
    </main>
    </div>
  );
}

export default AccountScreen;