

const SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search";


function isCityLike(place) {
  return typeof place.feature_code === "string" && place.feature_code.startsWith("PPL");
}


function makeValue(place) {
  if (place.country_code === "US" && place.admin1) {
    return `${place.name}, ${place.admin1}`;
  }
  return `${place.name}, ${place.country}`;
}


function makeDetail(place) {
  return [place.admin1, place.country]
    .filter((part) => part && part !== place.name)
    .join(", ");
}

export async function searchCities(text, countryCode) {
  const wanted = String(countryCode || "").toUpperCase();


  const url =
    `${SEARCH_URL}?name=${encodeURIComponent(text)}` +
    `&count=100&language=en&format=json` +
    (wanted ? `&countryCode=${wanted}` : "");


  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("The city search is not available right now.");
  }
  const data = await response.json();

  
  const places = (data.results || []).filter(
    (place) =>
      isCityLike(place) &&
      (!wanted || String(place.country_code || "").toUpperCase() === wanted)
  );


  const seen = new Set();
  const cities = [];
  for (const place of places) {
    const value = makeValue(place);
    const detail = makeDetail(place);
    if (seen.has(value + "|" + detail)) continue;
    seen.add(value + "|" + detail);
    cities.push({
      id: place.id,
      name: place.name,
      detail: detail,
      value: value,
    });
    if (cities.length === 6) break;
  }
  return cities;
}