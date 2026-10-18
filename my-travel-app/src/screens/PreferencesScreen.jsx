

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PREFERENCE_QUESTIONS,
  PRIORITY_HINTS,
  emptyAnswers,
  buildTravelProfile,
} from "../data/preferenceQuestions";
import { saveTravelProfile } from "../api/preferencesApi";
import "./ProfileScreen.css"; 
import "./SignUpScreen.css";
import "./PreferencesScreen.css";
import QuestionIcon from "../components/QuestionIcon";
import { findDestination } from "../data/destinations";
const LAST_INDEX = PREFERENCE_QUESTIONS.length - 1;



const slide = {
  enter: (direction) => ({ x: direction * 48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction) => ({ x: direction * -48, opacity: 0 }),
};

function PreferencesScreen({ profile, trip, onDone, initialAnswers, onCancel }) {

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [answers, setAnswers] = useState(initialAnswers || emptyAnswers());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const question = PREFERENCE_QUESTIONS[index];
  const value = answers[question.field];
  const isLast = index === LAST_INDEX;
  const answered = question.type === "multi" ? value.length > 0 : value !== null;

  // Remember one answer. DATA SAVED: only in this screen's memory.
  function setAnswer(field, newValue) {
    setAnswers((previous) => ({ ...previous, [field]: newValue }));
  }

  // Go to another question with a slide.
  function goTo(target, slideDirection) {
    setDirection(slideDirection);
    setIndex(target);
  }


  function handleOptionPick(optionValue) {
    setAnswer(question.field, optionValue);
    if (!isLast) {
      const nextIndex = index + 1;
      setTimeout(() => goTo(nextIndex, 1), 250);
    }
  }


  function handleMultiToggle(optionValue) {
    let updated;
    if (optionValue === "none") {
      updated = value.includes("none") ? [] : ["none"];
    } else if (value.includes(optionValue)) {
      updated = value.filter((item) => item !== optionValue);
    } else {
      updated = [...value.filter((item) => item !== "none"), optionValue];
    }
    setAnswer(question.field, updated);
  }


  function handleScaleChange(event) {
    const rounded = Math.round(Number(event.target.value) * 10) / 10;
    setAnswer(question.field, rounded);
  }


  async function finish(finalAnswers) {
    setBusy(true);
    setError("");
    try {
      const fullProfile = buildTravelProfile(finalAnswers);
      const travelProfile = initialAnswers
        ? Object.fromEntries(
            Object.entries(fullProfile).filter(
              ([field, preference]) =>
                JSON.stringify(preference.value) !==
                JSON.stringify(initialAnswers[field])
            )
          )
        : fullProfile;
      await saveTravelProfile(profile.userId, trip.familyId, travelProfile);
      onDone();
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  }


  function handleNextClick() {
    if (!answered || busy) return;
    if (isLast) {
      finish(answers);
    } else {
      goTo(index + 1, 1);
    }
  }


  function handleSkipClick() {
    if (busy) return;
    const emptyValue = question.type === "multi" ? [] : null;
    const updatedAnswers = { ...answers, [question.field]: emptyValue };
    setAnswers(updatedAnswers);
    if (isLast) {
      finish(updatedAnswers);
    } else {
      goTo(index + 1, 1);
    }
  }


  function handleBackClick() {
    if (index > 0 && !busy) goTo(index - 1, -1);
  }

  return (
    <div className="pref-page">
    <main className="pref">

      <header className="pref-top">
        {index > 0 ? (
          <button className="back-btn" onClick={handleBackClick} aria-label="Previous question">
            &larr;
          </button>
        ) : onCancel ? (

          <button className="back-btn" onClick={onCancel} aria-label="Close without saving">
            &times;
          </button>
        ) : (
          <div className="pref-back-space"></div>
        )}
        <div className="pref-progress-wrap">
          <div className="pref-count">
            QUESTION {index + 1} OF {PREFERENCE_QUESTIONS.length}
          </div>
          <div className="pref-bar">
            <motion.div
              className="pref-bar-fill"
              animate={{ width: `${((index + 1) / PREFERENCE_QUESTIONS.length) * 100}%` }}
              transition={{ type: "spring", stiffness: 160, damping: 22 }}
            />
          </div>
        </div>
      </header>


      <div className="pref-for">
        For your {findDestination(trip.destinationId)?.name || "upcoming"} trip
      </div>
      <div className="pref-body">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.section
            key={question.field}
            custom={direction}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
          >
            <QuestionIcon field={question.field} />
            <div className="pref-hint">{PRIORITY_HINTS[question.priority]}</div>
            <h1>{question.title}</h1>
            <p className="pref-sub">{question.subtitle}</p>


            {(question.type === "single" ||
              question.type === "boolean" ||
              question.type === "budget") && (
              <div
                className={
                  "pref-options" +
                  (question.type === "single" ? "" : " pref-options-row")
                }
              >
                {question.options.map((option) => (
                  <motion.button
                    key={String(option.value)}
                    className={
                      "pref-option" +
                      (question.type === "budget" ? " pref-option-budget" : "") +
                      (value === option.value ? " pref-option-selected" : "")
                    }
                    aria-pressed={value === option.value}
                    onClick={() => handleOptionPick(option.value)}
                    whileTap={{ scale: 0.97 }}
                  >
                    <span className="pref-option-label">{option.label}</span>
                    {option.note && <span className="pref-option-note">{option.note}</span>}
                  </motion.button>
                ))}
              </div>
            )}


            {question.type === "multi" && (
              <div className="pref-options">
                {question.options.map((option) => (
                  <motion.button
                    key={option.value}
                    className={
                      "pref-option" +
                      (value.includes(option.value) ? " pref-option-selected" : "")
                    }
                    aria-pressed={value.includes(option.value)}
                    onClick={() => handleMultiToggle(option.value)}
                    whileTap={{ scale: 0.97 }}
                  >
                    <span className="pref-option-label">{option.label}</span>
                  </motion.button>
                ))}
              </div>
            )}


            {question.type === "scale" && (
              <div className="pref-scale">
                <div className="pref-scale-labels">
                  <span>{question.low}</span>
                  <span>{question.high}</span>
                </div>
                <input
                  className="pref-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={value === null ? 0.5 : value}
                  onChange={handleScaleChange}
                  aria-label={question.title}
                />

                <button
                  className="link-btn pref-middle"
                  onClick={() => setAnswer(question.field, 0.5)}
                >
                  Right in the middle
                </button>
              </div>
            )}
          </motion.section>
        </AnimatePresence>
      </div>


      <footer className="pref-footer">
        {error && <p className="form-error">{error}</p>}

        <button className="link-btn pref-skip" onClick={handleSkipClick} disabled={busy}>
          Skip this question
        </button>

        <motion.button
          className="btn-go"
          onClick={handleNextClick}
          disabled={!answered || busy}
          whileTap={{ scale: 0.96 }}
        >
          {busy ? "Saving..." : isLast ? "Save my preferences" : "Next"}
        </motion.button>
      </footer>
    </main>
    </div>
  );
}

export default PreferencesScreen;