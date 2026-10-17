
import { useState } from "react";
import { motion } from "framer-motion";
import QuestionIcon from "../components/QuestionIcon";
import Stamp from "../components/Stamp";
import { LandscapeArt } from "../components/stampArt";
import { DESTINATION_STAMPS } from "../components/destinationStamps";
import { getCreatorId } from "../api/tripApi";
import { PREFERENCE_QUESTIONS } from "../data/preferenceQuestions";
import { findDestination } from "../data/destinations";
import { findAvatar } from "../data/avatars";
import AvatarArt from "../components/AvatarArt";
import {
  formatDateRange,
  describeTripTiming,
  formatDay,
  formatTime,
} from "../data/dates";
import "./ProfileScreen.css"; 
import "./SignUpScreen.css";
import "./TripScreen.css"; 

function TripScreen({
  trip,
  profile,
  hasPreferences,
  onBack,
  onEditPreferences,
  onEditTrip,
  onGeneratePlan,
}) {

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const destination = findDestination(trip.destinationId);
  const destinationName = destination ? destination.name : "Your trip";


  const creatorId = getCreatorId(trip);
  const isCreator = Boolean(creatorId) && creatorId === profile.userId;
  const creator = trip.members.find((member) => member.userId === creatorId);
  const creatorName = creator ? creator.name : "the trip creator";


  async function handleGenerateClick() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {

      const result = await onGeneratePlan();
      setNotice(result.message || "Your plan is being built.");
    } catch (problem) {
      setError(problem.message);
    }
    setBusy(false);
  }

  return (
    <div className="trip-page">
    <main className="tp">

      <div className="tp-top">

        <button className="back-btn" onClick={onBack} aria-label="Back to my trips">
          &larr;
        </button>
        <span className="tp-code">CODE {trip.tripCode}</span>
      </div>


      <header className="tp-header">
        <div className="tp-header-text">
          <h1>{destinationName}</h1>
          <div className="tp-meta">
            <span className="tp-dates">{formatDateRange(trip.startDate, trip.endDate)}</span>
            <span className="tp-chip">{describeTripTiming(trip.startDate, trip.endDate)}</span>
          </div>
        </div>


        <div className="tp-header-stamp" aria-hidden="true">
          <Stamp color="var(--ink)" fill="var(--gold)" w={88} h={110} rot={3} animate={false}>
            {DESTINATION_STAMPS[trip.destinationId] || <LandscapeArt />}
          </Stamp>
        </div>
      </header>


      <section className="tp-ticket">
        <div className="tp-ticket-side">
          <div className="tp-ticket-label">ARRIVE</div>
          <div className="tp-ticket-day">{formatDay(trip.startDate)}</div>
          <div className="tp-ticket-time">
            {trip.arrivalTime ? formatTime(trip.arrivalTime) : "No time set"}
          </div>
          {trip.arrivalCity && <div className="tp-ticket-time">{trip.arrivalCity}</div>}
        </div>
        <div className="tp-ticket-side">
          <div className="tp-ticket-label">DEPART</div>
          <div className="tp-ticket-day">{formatDay(trip.endDate)}</div>
          <div className="tp-ticket-time">
            {trip.departureTime ? formatTime(trip.departureTime) : "No time set"}
          </div>
          {trip.departureCity && <div className="tp-ticket-time">{trip.departureCity}</div>}
        </div>
      </section>

      {isCreator && onEditTrip && (
        <motion.button className="tp-edit" onClick={onEditTrip} whileTap={{ scale: 0.97 }}>
          Edit trip details
        </motion.button>
      )}


      <motion.button className="tp-prefs" onClick={onEditPreferences} whileTap={{ scale: 0.98 }}>
        <QuestionIcon field="tripPace" small />
        <div className="tp-prefs-text">
          <div className="tp-prefs-title">Your preferences for this trip</div>
          <div className="tp-prefs-sub">
            {hasPreferences
              ? "Review or change your answers"
              : `Not filled in yet. Tap to answer ${PREFERENCE_QUESTIONS.length} quick questions.`}
          </div>
        </div>
        <span className="tp-arrow" aria-hidden="true">&rsaquo;</span>
      </motion.button>


      <section className="tp-section">
        <h2>Travellers</h2>
        {trip.members.length === 0 && (
          <p className="tp-empty">No one has joined yet.</p>
        )}
        {trip.members.map((member, index) => {
          const avatar = findAvatar(member.avatar, member.userId);
          const isYou = member.userId === profile.userId;
          const isOrganizer = member.userId === creatorId;
          return (
            <div className="tp-member" key={index}>
              <span
                className="tp-member-avatar avatar-fill"
                style={{ background: avatar.background }}
              >
                <AvatarArt id={avatar.id} />
              </span>
              <span className="tp-member-name">{member.name}</span>
              {isOrganizer && <span className="tp-organizer">Organizer</span>}
              {isYou && <span className="tp-you">You</span>}
            </div>
          );
        })}
      </section>


      <section className="tp-plan">
        <div className="tp-plan-top">
          <QuestionIcon field="activityFocus" small />
          <div>
            <div className="tp-plan-title">Group itinerary</div>
            <div className="tp-plan-sub">
              {isCreator
                ? "When everyone has answered, build the plan for your group."
                : `Only ${creatorName} can generate the itinerary. It will appear here once it's ready.`}
            </div>
          </div>
        </div>


        {isCreator && (
          <motion.button
            className="tp-generate"
            onClick={handleGenerateClick}
            disabled={busy}
            whileTap={{ scale: 0.96 }}
          >
            {busy ? "Working..." : "Generate itinerary"}
          </motion.button>
        )}

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-note">{notice}</p>}
      </section>
    </main>
    </div>
  );
}

export default TripScreen;