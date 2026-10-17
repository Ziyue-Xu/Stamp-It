

import { DESTINATIONS, findDestination } from "../data/destinations";


export function toBackendDateTime(dateText, timeText) {
  const [year, month, day] = dateText.split("-").map(Number);
  const [hour24, minute] = (timeText || "12:00").split(":").map(Number);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${month}/${day}/${year}, ${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}


export function fromBackendDateTime(text) {
  if (!text) return { date: "", time: "" };


  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = us[3];
    let hour = Number(us[4]) % 12;
    if (us[6].toUpperCase() === "PM") hour += 12;
    return {
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      time: `${String(hour).padStart(2, "0")}:${us[5]}`,
    };
  }


  const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (iso) {
    return { date: iso[1], time: iso[2] || "" };
  }

  return { date: "", time: "" };
}


export function countryNameFor(destinationId) {
  const destination = findDestination(destinationId);
  return destination ? destination.name : destinationId;
}


export function destinationIdFor(countryName) {
  const wanted = String(countryName || "").trim().toLowerCase();
  const match = DESTINATIONS.find((destination) => destination.name.toLowerCase() === wanted);
  return match ? match.id : wanted.replace(/[^a-z]+/g, "-");
}