

import { motion } from "framer-motion";
import { findDestination } from "../data/destinations";
import { findAvatar } from "../data/avatars";
import AvatarArt from "../components/AvatarArt";
import { formatDateRange, describeTripTiming, formatTime } from "../data/dates";
import "./DashboardScreen.css";
import { getCreatorId } from "../api/tripApi";
import Stamp from "../components/Stamp";
import { LandscapeArt } from "../components/stampArt";
import { DESTINATION_STAMPS } from "../components/destinationStamps";


const STAMP_COLORS = ["var(--pink)", "var(--gold)", "var(--teal)"];

function DashboardScreen({
  profile,
  trips,
  onNewTrip,
  onJoinTrip,
  onOpenTrip,
  onOpenAccount,
  onSignOut,
}) {
  const myAvatar = findAvatar(profile.avatar, profile.userId);
  const firstName = profile.name.split(" ")[0];

  return (
    <div className="dash-page">
    <main className="dash">

      <header className="dash-top">
        <div>
          <p className="dash-hello">HI, {firstName}</p>
          <h1>Your trips</h1>
        </div>


        <motion.button
          className="dash-avatar avatar-fill"
          style={{ background: myAvatar.background }}
          onClick={onOpenAccount}
          aria-label="Your profile"
          whileTap={{ scale: 0.92 }}
        >
          <AvatarArt id={myAvatar.id} />
        </motion.button>
      </header>


      <div className="dash-stripe" aria-hidden="true"></div>

  
      <section className="dash-list">
        {trips.length === 0 && (
          <div className="dash-empty">
            <div className="dash-empty-title">No trips yet</div>
            <div>Plan a new one or join a friend's trip with a code.</div>
          </div>
        )}

        {trips.map((trip, index) => {
          const destination = findDestination(trip.destinationId);
          const destinationName = destination ? destination.name : "Trip";
          const stampColor = STAMP_COLORS[index % STAMP_COLORS.length];
          const arrive = formatTime(trip.arrivalTime);
          const depart = formatTime(trip.departureTime);

          return (

            <motion.button
              key={trip.tripCode}
              className="trip-row"
              onClick={() => onOpenTrip(trip)}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 20, delay: index * 0.06 }}
              whileTap={{ scale: 0.98 }}
            >

              <div className="trip-row-art" aria-hidden="true">
                <Stamp
                  color="var(--paper)"
                  fill={stampColor}
                  w={78}
                  h={98}
                  rot={index % 2 === 0 ? -3 : 3}
                  animate={false}
                >
                  {DESTINATION_STAMPS[trip.destinationId] || <LandscapeArt />}
                </Stamp>
              </div>

              <div className="trip-row-main">
                <div className="trip-row-name">{destinationName}</div>
                <div className="trip-row-dates">
                  {formatDateRange(trip.startDate, trip.endDate)}
                </div>
                {(arrive || depart) && (
                  <div className="trip-row-times">
                    {arrive && <span>ARRIVAL {arrive}</span>}
                    {depart && <span>DEPARTURE {depart}</span>}
                  </div>
                )}
                <div className="trip-row-chips">
                  <span className="trip-chip">
                    {describeTripTiming(trip.startDate, trip.endDate)}
                  </span>
                  <span className="trip-chip trip-chip-code">Code {trip.tripCode}</span>
                  {getCreatorId(trip) === profile.userId && (
                    <span className="trip-chip trip-chip-organizer">Organizer</span>
                  )}
                </div>
                <div className="trip-row-people">
                  <div className="people-stack">
                    {trip.members.slice(0, 4).map((member, memberIndex) => {
                      const avatar = findAvatar(member.avatar, member.userId);
                      return (
                        <span
                          key={memberIndex}
                          className="people-chip avatar-fill"
                          style={{ background: avatar.background }}
                          title={member.name}
                        >
                          <AvatarArt id={avatar.id} />
                        </span>
                      );
                    })}
                  </div>
                  <span className="people-count">
                    {trip.members.length === 1 ? "1 traveller" : `${trip.members.length} travellers`}
                  </span>
                </div>
              </div>
            </motion.button>
          );
        })}
      </section>

      <div className="dash-actions">

        <motion.button className="dash-btn dash-btn-main" onClick={onNewTrip} whileTap={{ scale: 0.96 }}>
          Plan a new trip
        </motion.button>


        <motion.button className="dash-btn dash-btn-alt" onClick={onJoinTrip} whileTap={{ scale: 0.96 }}>
          Join a trip
        </motion.button>


        <button className="dash-signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </main>
    </div>
  );
}

export default DashboardScreen;