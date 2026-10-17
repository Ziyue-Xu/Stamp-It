

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Stamp from "../components/Stamp";
import { LandscapeArt } from "../components/stampArt";
import { DESTINATION_STAMPS } from "../components/destinationStamps";
import { formatDay, formatTime } from "../data/dates";
import SplitBlock from "../components/SplitBlock";
import { formatMoney, sortItems, recalculatePlan } from "../api/planFormat";
import { savePlan, resetPlan } from "../api/planApi";
import "./PlanScreen.css";
import "./PlanEdit.css";


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


const KIND_CHOICES = [
  ["activity", "DO"],
  ["meal", "EAT"],
  ["lodging", "STAY"],
  ["transit", "GO"],
];


function toMinutes(timeText) {
  const [hours, mins] = timeText.split(":").map(Number);
  return hours * 60 + mins;
}


function newStopId() {
  return "mine-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
}


function StopForm({ initial, currency, onSave, onCancel, onDelete }) {

  const [type, setType] = useState(initial.type);
  const [title, setTitle] = useState(initial.title);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [address, setAddress] = useState(initial.address);
  const [cost, setCost] = useState(initial.cost && initial.cost.amount ? String(initial.cost.amount) : "");
  const [notes, setNotes] = useState(initial.tips.join("\n"));
  const [problem, setProblem] = useState("");

  const isNew = !initial.id;

 
  function handleSubmit(event) {
    event.preventDefault();
    setProblem("");
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setProblem("Give the stop a name.");
      return;
    }
    if (start && end && end < start) {
      setProblem("The end time can't be before the start time.");
      return;
    }
    const amount = cost.trim() === "" ? 0 : Number(cost);
    if (Number.isNaN(amount) || amount < 0) {
      setProblem("Cost should be a number like 12 or 7.50.");
      return;
    }


    let minutes = null;
    if (start && end && end !== "23:59") minutes = toMinutes(end) - toMinutes(start);
    else if (end === "23:59") minutes = initial.minutes;

    onSave({
      ...initial,
      type,
      title: cleanTitle,
      start,
      end,
      minutes,
      address: address.trim(),
      cost: amount > 0 ? { amount, currency: (initial.cost && initial.cost.currency) || currency } : null,
      tips: notes.split("\n").map((line) => line.trim()).filter(Boolean),
    });
  }

  return (
    <form className="plan-form" onSubmit={handleSubmit} noValidate>
      <div className="plan-form-title">{isNew ? "ADD YOUR OWN STOP" : "EDIT THIS STOP"}</div>

      <div className="plan-field">
        <span className="plan-field-label">WHAT KIND</span>
        <div className="plan-kind-choices">
          {KIND_CHOICES.map(([value, label]) => (

            <button
              type="button"
              key={value}
              className={"plan-kind-choice" + (type === value ? " plan-kind-choice-selected" : "")}
              aria-pressed={type === value}
              onClick={() => setType(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="plan-field">
        <span className="plan-field-label">NAME</span>
        <input
          type="text"
          value={title}
          maxLength={120}
          placeholder="e.g. Picnic by the river"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <div className="plan-field-row">
        <label className="plan-field">
          <span className="plan-field-label">STARTS</span>
          <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="plan-field">
          <span className="plan-field-label">ENDS</span>
          <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>

      <label className="plan-field">
        <span className="plan-field-label">WHERE (OPTIONAL)</span>
        <input
          type="text"
          value={address}
          maxLength={160}
          placeholder="Address or place"
          onChange={(event) => setAddress(event.target.value)}
        />
      </label>

      <label className="plan-field">
        <span className="plan-field-label">COST PER PERSON, {currency} (OPTIONAL)</span>
        <input
          type="text"
          inputMode="decimal"
          value={cost}
          placeholder="0"
          onChange={(event) => setCost(event.target.value)}
        />
      </label>

      <label className="plan-field">
        <span className="plan-field-label">NOTES (ONE PER LINE, OPTIONAL)</span>
        <textarea value={notes} maxLength={600} onChange={(event) => setNotes(event.target.value)} />
      </label>

      {problem && <p className="plan-form-problem" role="alert">{problem}</p>}

      <div className="plan-form-actions">

        <button type="submit" className="plan-form-save">SAVE</button>


        <button type="button" className="plan-form-cancel" onClick={onCancel}>CANCEL</button>


        {onDelete && (
          <button type="button" className="plan-form-delete" onClick={onDelete}>REMOVE</button>
        )}
      </div>
    </form>
  );
}


function TransitRow({ item, onEdit }) {
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

        <button className="plan-edit-btn" onClick={onEdit} aria-label={"Edit " + item.title}>EDIT</button>
      </div>
    </li>
  );
}


function StopCard({ item, open, onToggle, onEdit }) {
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
        {item.addedBy && <div className="plan-added-by">ADDED BY {item.addedBy.name.toUpperCase()}</div>}


        {hasTips && (
          <button className="plan-tips-btn" onClick={onToggle} aria-expanded={open}>
            {open ? "HIDE TIPS" : `TIPS (${item.tips.length})`}
          </button>
        )}

        <button className="plan-edit-btn" onClick={onEdit} aria-label={"Edit " + item.title}>
          EDIT
        </button>
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

function PlanScreen({ plan, trip, profile, onPlanChange, onBack }) {

  const [dayIndex, setDayIndex] = useState(0);
  const [openTips, setOpenTips] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [saveState, setSaveState] = useState("");

  const day = plan.days[dayIndex];
  const currency = (plan.total && plan.total.currency) || (day.total && day.total.currency) || "EUR";


  async function commit(newPlan) {
    onPlanChange(newPlan);
    setSaveState("saving");
    try {
      const where = await savePlan(trip.familyId, profile.userId, newPlan);
      setSaveState(where === "device" ? "device" : "saved");
    } catch (problem) {
      setSaveState("failed");
    }
  }


  function planWithDayItems(items) {
    const days = plan.days.map((d, index) =>
      index === dayIndex ? { ...d, items: sortItems(items) } : d
    );
    return recalculatePlan({ ...plan, days });
  }


  function handleSaveStop(stop) {
    const isOld = Boolean(stop.id) && day.items.some((item) => item.id === stop.id);
    const items = isOld
      ? day.items.map((item) => (item.id === stop.id ? stop : item))
      : [
          ...day.items,
          {
            ...stop,
            id: newStopId(),
            addedBy: { userId: profile.userId, name: profile.name },
          },
        ];
    setEditingId(null);
    commit(planWithDayItems(items));
  }


  function handleDeleteStop(id) {
    if (!window.confirm("Remove this stop from the itinerary?")) return;
    setEditingId(null);
    commit(planWithDayItems(day.items.filter((item) => item.id !== id)));
  }


  function handlePickTrack(splitId, groupId) {
    const days = plan.days.map((d, index) =>
      index !== dayIndex
        ? d
        : {
            ...d,
            items: d.items.map((item) =>
              item.id === splitId
                ? { ...item, picks: { ...(item.picks || {}), [profile.userId]: groupId } }
                : item
            ),
          }
    );
    commit({ ...plan, days });
  }


  async function handleReset() {
    if (!window.confirm("Throw away everyone's edits and go back to the original itinerary?")) return;
    const result = await resetPlan(trip.familyId, trip);
    onPlanChange(result.plan);
    setEditingId(null);
    setDayIndex(0);
    setSaveState("");
  }


  const blankStop = {
    id: "",
    type: "activity",
    title: "",
    start: "",
    end: "",
    minutes: null,
    place: "",
    address: "",
    transit: null,
    tips: [],
    cost: null,
    addedBy: null,
  };

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

      {/* Shown ONLY for the saved example itinerary, so nobody mistakes it for real */}
      {plan.isSample && (
        <p className="plan-sample">
          EXAMPLE ITINERARY. Shown while the backend isn't building plans yet.
          Your edits and track picks are kept in this browser only.
        </p>
      )}


      <p className={"plan-savestate" + (saveState === "failed" ? " plan-savestate-failed" : "")} aria-live="polite">
        {saveState === "saving" && "SAVING..."}
        {saveState === "saved" && "SAVED"}
        {saveState === "device" && "SAVED ON THIS DEVICE ONLY"}
        {saveState === "failed" && (
          <>
            COULDN'T SAVE YOUR CHANGES.

            <button className="plan-link-btn" onClick={() => commit(plan)}>TRY AGAIN</button>
          </>
        )}
      </p>


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
            onClick={() => {
              setDayIndex(index);
              setEditingId(null);
            }}
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
              editingId === item.id ? (
                <li className="plan-edit-row" key={item.id}>
                  <StopForm
                    initial={item}
                    currency={currency}
                    onSave={handleSaveStop}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => handleDeleteStop(item.id)}
                  />
                </li>
              ) : item.type === "split" ? (
                /* A "group splits up" moment. Each person picks ONE track. */
                <SplitBlock
                  item={item}
                  key={item.id}
                  me={profile.userId}
                  members={trip.members || []}
                  onPick={(groupId) => handlePickTrack(item.id, groupId)}
                />
              ) : item.type === "transit" ? (
                <TransitRow item={item} key={item.id} onEdit={() => setEditingId(item.id)} />
              ) : (
                <StopCard
                  item={item}
                  key={item.id}
                  open={Boolean(openTips[item.id])}
                  onToggle={() => toggleTips(item.id)}
                  onEdit={() => setEditingId(item.id)}
                />
              )
            )}
            {editingId === "new" && (
              <li className="plan-edit-row">
                <StopForm
                  initial={blankStop}
                  currency={currency}
                  onSave={handleSaveStop}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            )}
          </ol>


          {editingId !== "new" && (
            <button className="plan-add-btn" onClick={() => setEditingId("new")}>
              + ADD A STOP
            </button>
          )}
        </motion.section>
      </AnimatePresence>


      {plan.isSample && (
        <button className="plan-reset-btn" onClick={handleReset}>
          UNDO ALL EDITS
        </button>
      )}
    </main>
    </div>
  );
}

export default PlanScreen;