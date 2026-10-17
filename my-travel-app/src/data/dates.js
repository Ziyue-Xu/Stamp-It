

// Today's date as "YYYY-MM-DD" (the earliest a trip can start).
export function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// Turns "2027-03-14" into a real date (on that day, local time).
function parseDate(text) {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Turns a date string into short text, like "Mar 14".

export function formatDay(text) {
  if (!text) return "";
  return parseDate(text).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Turns a 24-hour time like "14:30" into  text like "2:30 PM".
// Returns "" when there is no time (so screens can hide it).
export function formatTime(text) {
  if (!text) return "";
  const [hour, minute] = text.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

// Turns two date strings into friendly text, like "Mar 14 to Mar 22, 2027".
export function formatDateRange(startText, endText) {
  if (!startText || !endText) return "";
  const start = parseDate(startText);
  const end = parseDate(endText);

  const withYear = { month: "short", day: "numeric", year: "numeric" };
  const noYear = { month: "short", day: "numeric" };

  // Show the year on both dates only if the trip crosses two years.
  const sameYear = start.getFullYear() === end.getFullYear();
  const startText2 = start.toLocaleDateString("en-US", sameYear ? noYear : withYear);
  const endText2 = end.toLocaleDateString("en-US", withYear);
  return `${startText2} to ${endText2}`;
}

// Turns trip dates into a friendly status for the dashboard cards:
// "Starts in 12 days", "Starts tomorrow", "Happening now", "Trip ended".
export function describeTripTiming(startText, endText) {
  if (!startText || !endText) return "";
  const today = parseDate(todayString());
  const start = parseDate(startText);
  const end = parseDate(endText);

  if (today > end) return "Trip ended";
  if (today >= start) return "Happening now";

  const oneDay = 24 * 60 * 60 * 1000;
  const daysLeft = Math.round((start - today) / oneDay);
  return daysLeft === 1 ? "Starts tomorrow" : `Starts in ${daysLeft} days`;
}