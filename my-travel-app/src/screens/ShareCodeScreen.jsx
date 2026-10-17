
import { useState } from "react";
import { motion } from "framer-motion";
import { findDestination } from "../data/destinations";
import { findAvatar } from "../data/avatars";
import AvatarArt from "../components/AvatarArt";
import "./ShareCodeScreen.css";
import { formatDateRange, formatDay, formatTime } from "../data/dates";

function ShareCodeScreen({ trip, onContinue }) {
  
  // (so the button can say "Copied!").
  const [copied, setCopied] = useState(false);

  const destination = findDestination(trip.destinationId);
  const destinationName = destination ? destination.name : "your";

  // Split "7K2Q" so each gets its own tile.
  const letters = trip.tripCode.split("");


  const canShare = typeof navigator.share === "function";


  async function handleCopyClick() {
    try {
      await navigator.clipboard.writeText(trip.tripCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.log("Could not copy the code", error);
    }
  }


  async function handleShareClick() {
    try {
      await navigator.share({
        title: "Join my trip",
        text: `Join my ${destinationName} trip! Code: ${trip.tripCode}`,
      });
    } catch (error) {
      console.log("Share was closed", error);
    }
  }

  return (
    <div className="share-page">
    <main className="share">
      <div className="share-chip">Your trip is ready</div>
      <h1>{destinationName} awaits</h1>
      {trip.startDate && trip.endDate && (
        <div className="share-dates">
          {formatDateRange(trip.startDate, trip.endDate)}
        </div>
      )}
      <p className="share-sub">
        Send this code to your group. They'll type it in on the Join screen.
      </p>

  
      <section className="ticket">
        <div className="ticket-top">
          <div className="ticket-label">TRIP CODE</div>
          <div className="code-row">
            {letters.map((letter, index) => (
              <motion.div
                key={index}
                className="code-tile"
                initial={{ opacity: 0, y: 20, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", delay: 0.1 + index * 0.1 }}
              >
                {letter}
              </motion.div>
            ))}
          </div>
        </div>


        <div className="ticket-trip">
          <div className="ticket-leg">
            <div className="ticket-leg-label">ARRIVE</div>
            <div className="ticket-leg-day">{formatDay(trip.startDate)}</div>
            <div className="ticket-leg-time">{formatTime(trip.arrivalTime) || "No time set"}</div>
            {trip.arrivalCity && <div className="ticket-leg-time">{trip.arrivalCity}</div>}
          </div>
          <div className="ticket-leg-arrow" aria-hidden="true">&rarr;</div>
          <div className="ticket-leg">
            <div className="ticket-leg-label">DEPART</div>
            <div className="ticket-leg-day">{formatDay(trip.endDate)}</div>
            <div className="ticket-leg-time">{formatTime(trip.departureTime) || "No time set"}</div>
            {trip.departureCity && <div className="ticket-leg-time">{trip.departureCity}</div>}
          </div>
        </div>


        <div className="ticket-tear" aria-hidden="true"></div>

        <div className="ticket-bottom">
          <div className="avatar-stack">
            {trip.members.map((member, index) => {
              const avatar = findAvatar(member.avatar, member.userId);
              return (
                <div
                  key={index}
                  className="avatar-chip avatar-fill"
                  style={{ background: avatar.background }}
                  title={member.name}
                >
                  <AvatarArt id={avatar.id} />
                </div>
              );
            })}
          </div>
          <div className="ticket-count">
            {trip.members.length === 0
              ? "You'll appear here after sign-up"
              : trip.members.length === 1
              ? "1 traveller"
              : `${trip.members.length} travellers`}
          </div>
        </div>
      </section>

      <div className="share-actions">
        <motion.button
          className="btn-outline"
          onClick={handleCopyClick}
          whileTap={{ scale: 0.96 }}
        >
          {copied ? "Copied!" : "Copy code"}
        </motion.button>


        {canShare && (
          <motion.button
            className="btn-outline"
            onClick={handleShareClick}
            whileTap={{ scale: 0.96 }}
          >
            Share
          </motion.button>
        )}
      </div>


      <motion.button className="btn-go" onClick={onContinue} whileTap={{ scale: 0.96 }}>
        Continue
      </motion.button>
    </main>
    </div>
  );
}

export default ShareCodeScreen;