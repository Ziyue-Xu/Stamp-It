

import { useState } from "react";
import { motion } from "framer-motion";
import {
  POPULAR_IDS,
  findDestination,
  searchDestinations,
} from "../data/destinations";
import { todayString } from "../data/dates";
import "./CreateTripScreen.css";
import Stamp from "../components/Stamp";
import {
  TajMahalArt,
  LibertyArt,
  EiffelArt,
  FujiArt,
  LandscapeArt,
} from "../components/stampArt";
import { DESTINATION_STAMPS } from "../components/destinationStamps";


function CreateTripScreen({ selectedId, onSelect, onCreate, initialTrip, onSave, onBack }) {
  // Are we EDITING an existing trip? (true when initialTrip was passed in)
  const editing = Boolean(initialTrip);


  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState(editing ? initialTrip.startDate : "");
  const [endDate, setEndDate] = useState(editing ? initialTrip.endDate : "");
  const [arrivalTime, setArrivalTime] = useState(editing ? initialTrip.arrivalTime || "" : "");
  const [departureTime, setDepartureTime] = useState(
    editing ? initialTrip.departureTime || "" : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The matches for what's typed. Runs right here, no backend needed.
  const results = searchDestinations(query);
  const popular = POPULAR_IDS.map(findDestination);
  const selected = findDestination(selectedId);


  const today = todayString();
  const keepsOldStart = editing && startDate === initialTrip.startDate;
  const startOk = startDate >= today || keepsOldStart;
  const datesOk = startDate !== "" && endDate !== "" && startOk && endDate >= startDate;
  // The earliest day the start-date box lets you pick.
  const startMin = keepsOldStart && initialTrip.startDate < today ? initialTrip.startDate : today;


  const timesFilled = arrivalTime !== "" && departureTime !== "";
  const sameDayProblem =
    timesFilled && startDate !== "" && startDate === endDate && departureTime <= arrivalTime;
  const timesOk = timesFilled && !sameDayProblem;


  const changed =
    !editing ||
    selectedId !== initialTrip.destinationId ||
    startDate !== initialTrip.startDate ||
    endDate !== initialTrip.endDate ||
    arrivalTime !== (initialTrip.arrivalTime || "") ||
    departureTime !== (initialTrip.departureTime || "");

  const canCreate = Boolean(selectedId) && datesOk && timesOk && changed;


  function handlePick(id) {
    onSelect(id);
    setQuery("");
  }

  // Pressing Enter in the search box picks the first result.
  function handleSearchKeyDown(event) {
    if (event.key === "Enter" && results.length > 0) {
      handlePick(results[0].id);
    }
  }

  function handleStartDateChange(event) {
    const value = event.target.value;
    setStartDate(value);
    if (endDate && endDate < value) {
      setEndDate("");
    }
  }


  async function handleCreateClick() {
    if (!canCreate || busy) return;
    setBusy(true);
    setError("");
    try {
      // >>>>> DATA LEAVES HERE (the trip's dates and times go out)
      const send = editing ? onSave : onCreate;
      await send({ startDate, endDate, arrivalTime, departureTime });
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  }

  return (
    <div className="create-page">
    <main className="create">
      {/* TOP ROW: back arrow (left) + three little decoration stamps (right) */}
      <div className="create-top">

        <button className="back-btn" onClick={onBack} aria-label="Go back">
          &larr;
        </button>


        <div className="create-stamps" aria-hidden="true">
          <Stamp color="var(--pink)" w={52} h={66} rot={-6}>
            <TajMahalArt />
          </Stamp>
          <Stamp color="var(--gold)" w={52} h={66} rot={4}>
            <LibertyArt />
          </Stamp>
          <Stamp color="var(--ink)" fill="var(--pink)" w={52} h={66} rot={-3}>
            <FujiArt />
          </Stamp>
        </div>
      </div>

      <h1>{editing ? "Edit your trip" : "Where are you headed?"}</h1>
      <p className="create-sub">
        {editing
          ? "Change the place, the dates or the times."
          : "Search for your destination."}
      </p>


      <label className="field-label" htmlFor="destination-search">
        Add your destination
      </label>
      <input
        id="destination-search"
        className="search-input"
        value={query}
        placeholder="Try Italy, Kenya, Peru..."
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleSearchKeyDown}
      />

      {query.trim() ? (
        <div className="result-list">
          {results.length === 0 && (
            <p className="no-match">No country found. Check the spelling?</p>
          )}
          {results.map((destination) => (

            <button
              key={destination.id}
              className="result-row"
              onClick={() => handlePick(destination.id)}
            >
              <span className="result-dots">
                <span style={{ background: destination.theme.terracotta }}></span>
                <span style={{ background: destination.theme.gold }}></span>
                <span style={{ background: destination.theme.teal }}></span>
              </span>
              {destination.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="chip-row">
          <span className="chip-label">Popular</span>
          {popular.map((destination) => (

            <button
              key={destination.id}
              className="chip"
              onClick={() => handlePick(destination.id)}
            >
              {destination.name}
            </button>
          ))}
        </div>
      )}


      {selected && (
        <motion.div
          key={selected.id}
          className="trip-card"
          initial={{ opacity: 0, y: 24, rotate: 0 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 16 }}
        >

          <div aria-hidden="true">
            <Stamp color="var(--ink)" fill="var(--sky)" w={78} h={96} rot={-3}>
              {DESTINATION_STAMPS[selected.id] || <LandscapeArt />}
            </Stamp>
          </div>
          <div>
            <div className="trip-card-label">YOUR DESTINATION</div>
            <div className="trip-card-name">{selected.name}</div>
          </div>
        </motion.div>
      )}


      <div className="date-row">
        <div className="date-field">
          <label className="field-label" htmlFor="start-date">
            Trip starts
          </label>
          <input
            id="start-date"
            className="date-input"
            type="date"
            value={startDate}
            min={startMin}
            onChange={handleStartDateChange}
          />
        </div>
        <div className="date-field">
          <label className="field-label" htmlFor="end-date">
            Trip ends
          </label>
          <input
            id="end-date"
            className="date-input"
            type="date"
            value={endDate}
            min={startDate || startMin}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
      </div>

      <div className="date-row">
        <div className="date-field">
          <label className="field-label" htmlFor="arrival-time">
            Arrival time
          </label>
          <input
            id="arrival-time"
            className="date-input"
            type="time"
            value={arrivalTime}
            onChange={(event) => setArrivalTime(event.target.value)}
          />
        </div>
        <div className="date-field">
          <label className="field-label" htmlFor="departure-time">
            Departure time
          </label>
          <input
            id="departure-time"
            className="date-input"
            type="time"
            value={departureTime}
            onChange={(event) => setDepartureTime(event.target.value)}
          />
        </div>
      </div>
      <p className="time-hint">
        {sameDayProblem
          ? "On a one-day trip, the departure has to be after the arrival."
          : "Required. When you land on the first day, and when you head home on the last."}
      </p>

      {/* If saving failed, say why (red). */}
      {error && (
        <p className="time-hint" style={{ color: "var(--terracotta)", fontWeight: 700 }}>
          {error}
        </p>
      )}

      <motion.button
        className="btn-go"
        onClick={handleCreateClick}
        disabled={!canCreate || busy}
        whileTap={{ scale: 0.96 }}
      >
        {busy ? "Saving..." : editing ? "Save changes" : "Create trip"}
      </motion.button>
    </main>
    </div>
  );
}

export default CreateTripScreen;