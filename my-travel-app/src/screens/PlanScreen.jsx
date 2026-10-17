
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Stamp from "../components/Stamp";
import { LandscapeArt } from "../components/stampArt";
import { DESTINATION_STAMPS } from "../components/destinationStamps";
import { formatDay, formatTime } from "../data/dates";
import { formatMoney } from "../api/planFormat";
import "./PlanScreen.css";


const TYPE_LABELS = {
  activity: "DO",
  meal: "EAT",
  lodging: "STAY",
  transit: "GO",
};


const MODE_LABELS = {
  walking: "WALK",
  subway: "METRO",
  bus: "BUS",
  train: "TRAIN",
  tram: "TRAM",
  taxi: "TAXI",
  ferry: "FERRY",
  flight: "FLIGHT",
  car: "CAR",
  bike: "BIKE",
};


function weekdayOf(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "short" });
}


function formatMinutes(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}


function timeRange(item) {
  if (!item.end || item.end === "23:59" || item.end === item.start) {
    return [formatTime(item.start)];
  }
  return [formatTime(item.start), "to " + formatTime(item.end)];
}


function TransitRow({ item }) {
  const [startText] = timeRange(item);
  const mode = item.transit ? MODE_LABELS[item.transit.mode] || item.transit.mode.toUpperCase() : "GO";
  const bits = [];
  if (item.minutes) bits.push(formatMinutes(item.minutes));
  if (item.transit && item.transit.km) bits.push(`${item.transit.km} km`);
  if (item.cost && item.cost.amount > 0) bits.push(formatMoney(item.cost.amount, item.cost.currency));
  return (
    <li className="plan-stop plan-stop-transit">
      <div className="plan-stop-time">{startText}</div>
      <div className="plan-go">
        <span className="plan-mode">{mode}</span>
        <span className="plan-go-text">
          <span className="plan-go-title">{item.title}</span>
          <span className="plan-go-meta">
            {item.transit && item.transit.line ? item.transit.line : ""}
            {bits.length > 0 ? (item.transit && item.transit.line ? " · " : "") + bits.join(" · ") : ""}
          </span>
        </span>
      </div>
    </li>
  );
}


function StopCard({ item, open, onToggle }) {
  const [startText, endText] = timeRange(item);
  const hasTips = item.tips.length > 0;
  return (
    <li className="plan-stop">
      <div className="plan-stop-time">
        {startText}
        {endText && <span className="plan-stop-end">{endText}</span>}
      </div>
      <div className={"plan-card plan-card-" + item.type}>
        <div className="plan-card-top">
          <span className={"plan-kind plan-kind-" + item.type}>
            {TYPE_LABELS[item.type] || item.type.toUpperCase()}
          </span>
          <span className="plan-card-meta">
            {item.minutes ? <span className="plan-length">{formatMinutes(item.minutes)}</span> : null}
            {item.cost && item.cost.amount > 0 && (
              <span className="plan-cost">{formatMoney(item.cost.amount, item.cost.currency)}</span>
            )}
          </span>
        </div>
        <div className="plan-card-title">{item.title}</div>
        {item.address && <div className="plan-card-address">{item.address}</div>}

        {hasTips && (
          <button className="plan-tips-btn" onClick={onToggle} aria-expanded={open}>
            {open ? "HIDE TIPS" : `TIPS (${item.tips.length})`}
          </button>
        )}
        {hasTips && open && (
          <ul className="plan-tips">
            {item.tips.map((tip, index) => (
              <li key={index}>{tip}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function PlanScreen({ plan, trip, onBack }) {

  const [dayIndex, setDayIndex] = useState(0);
  const [openTips, setOpenTips] = useState({});

  const day = plan.days[dayIndex];

  function toggleTips(id) {
    setOpenTips((before) => ({ ...before, [id]: !before[id] }));
  }

  return (
    <div className="plan-page">
    <main className="plan">

      <div className="plan-top">

        <button className="back-btn" onClick={onBack} aria-label="Back to the trip">
          &larr;
        </button>
        <span className="plan-label">GROUP ITINERARY</span>
      </div>


      <header className="plan-header">
        <div className="plan-header-text">
          <h1>{plan.title}</h1>
          {plan.subtitle && <p className="plan-subtitle">{plan.subtitle}</p>}
          <p className="plan-days-count">
            {plan.days.length === 1 ? "1 day" : `${plan.days.length} days`}
            {plan.total ? ` · about ${formatMoney(plan.total.amount, plan.total.currency)} each` : ""}
          </p>
        </div>
        <div className="plan-header-stamp" aria-hidden="true">
          <Stamp color="var(--ink)" fill="var(--pink)" w={78} h={98} rot={3} animate={false}>
            {DESTINATION_STAMPS[trip.destinationId] || <LandscapeArt />}
          </Stamp>
        </div>
      </header>


      {plan.cities.length > 1 && (
        <section className="plan-route" aria-label="Route">
          {plan.cities.map((city, index) => (
            <div className="plan-route-item" key={index}>
              {index > 0 && <span className="plan-route-line" aria-hidden="true"></span>}
              <div className="plan-route-stop">
                <span className="plan-route-name">{city.name}</span>
                <span className="plan-route-days">
                  {city.days === 1 ? "1 day" : `${city.days} days`}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}


      {plan.isSample && (
        <p className="plan-sample">
          EXAMPLE ITINERARY. Shown while the backend isn't building plans yet.
        </p>
      )}


      {plan.notes && plan.notes.length > 0 && (
        <section className="plan-blend">
          <div className="plan-blend-title">HOW WE BLENDED YOUR GROUP</div>
          <div className="plan-blend-list">
            {plan.notes.map((note, index) => (
              <div className="blend-tag" key={index}>
                <span className="blend-kind">{note.label.toUpperCase()}</span>
                {note.detail && <span className="blend-detail">{note.detail}</span>}
                <span className="blend-text">{note.resolution}</span>
              </div>
            ))}
          </div>
        </section>
      )}


      <nav className="plan-tabs" aria-label="Days">
        {plan.days.map((planDay, index) => (

          <button
            key={planDay.dayNumber}
            className={"plan-tab" + (index === dayIndex ? " plan-tab-selected" : "")}
            aria-pressed={index === dayIndex}
            onClick={() => setDayIndex(index)}
          >
            <span className="plan-tab-day">DAY {planDay.dayNumber}</span>
            <span className="plan-tab-date">{formatDay(planDay.date)}</span>
            <span className="plan-tab-city">{planDay.city}</span>
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        <motion.section
          key={day.dayNumber}
          className="plan-day"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.18 }}
        >
          <div className="plan-day-head">
            <div className="plan-day-name">
              {weekdayOf(day.date).toUpperCase()} {formatDay(day.date).toUpperCase()}
            </div>
            <div className="plan-day-city">
              <span className="plan-day-city-tag">{day.city.toUpperCase()}</span>
              {day.total && (
                <span className="plan-day-total">
                  about {formatMoney(day.total.amount, day.total.currency)} each today
                </span>
              )}
            </div>
            <div className="plan-day-theme">{day.theme}</div>
          </div>

          <ol className="plan-stops">
            {day.items.map((item) =>
              item.type === "transit" ? (
                <TransitRow item={item} key={item.id} />
              ) : (
                <StopCard
                  item={item}
                  key={item.id}
                  open={Boolean(openTips[item.id])}
                  onToggle={() => toggleTips(item.id)}
                />
              )
            )}
          </ol>
        </motion.section>
      </AnimatePresence>
    </main>
    </div>
  );
}

export default PlanScreen;