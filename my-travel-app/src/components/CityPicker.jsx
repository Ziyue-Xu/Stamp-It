

import { useEffect, useState } from "react";
import { searchCities } from "../api/cityApi";

function CityPicker({
  id,
  label,
  placeholder,
  countryCode,
  countryName,
  value,
  onChange,
  onValidChange,
}) {

  const [ok, setOk] = useState({ text: value, country: countryCode });
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [suggestions, setSuggestions] = useState([]);

  const locked = !countryCode;
  const trimmed = value.trim();
  const isKnownGood = value === ok.text && countryCode === ok.country;
  const needsCheck = !locked && trimmed.length >= 2 && !isKnownGood;
  const isValid = trimmed === "" || isKnownGood || status === "failed";


  useEffect(() => {
    onValidChange(isValid);
  
  }, [isValid]);


  useEffect(() => {
    if (!open || !needsCheck) {
      setSuggestions([]);
      return;
    }
    let stale = false;
    setStatus("loading");
    const timer = setTimeout(async () => {
      try {

        const found = await searchCities(trimmed, countryCode);
        if (stale) return;
        setSuggestions(found);
        setStatus("done");
      } catch (problem) {
        if (stale) return;
        setSuggestions([]);
        setStatus("failed");
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [trimmed, countryCode, open, needsCheck]);

 
  function handleType(event) {
    onChange(event.target.value);
    setStatus("idle");
    setOpen(true);
  }


  function handlePick(city) {
    onChange(city.value);
    setOk({ text: city.value, country: countryCode });
    setSuggestions([]);
    setStatus("idle");
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (needsCheck && suggestions.length > 0) handlePick(suggestions[0]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }


  const showList = open && needsCheck && status !== "idle";

  return (
    <div className="date-field city-picker">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="date-input"
        type="text"
        value={value}
        maxLength={60}
        placeholder={locked ? "Pick a country first" : placeholder}
        disabled={locked}
        autoComplete="off"
        onChange={handleType}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />

      {showList && (

        <ul className="city-list" onMouseDown={(event) => event.preventDefault()}>
          {status === "loading" && <li className="city-note">Searching...</li>}
          {status === "failed" && (
            <li className="city-note">Can't check cities right now. We'll save it as typed.</li>
          )}
          {status === "done" && suggestions.length === 0 && (
            <li className="city-note">
              No city found in {countryName || "this country"}. Check the spelling?
            </li>
          )}
          {status === "done" &&
            suggestions.map((city) => (
              <li key={city.id}>
 
                <button type="button" className="city-option" onClick={() => handlePick(city)}>
                  <span className="city-option-name">{city.name}</span>
                  {city.detail && <span className="city-option-detail">{city.detail}</span>}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export default CityPicker;