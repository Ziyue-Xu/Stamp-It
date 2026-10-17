
import { japan } from "../themes/japan";
import { mexico } from "../themes/mexico";
import { portugal } from "../themes/portugal";
import { makeTheme } from "../themes/makeTheme";
import { COUNTRY_NAMES } from "./countries";

const HAND_MADE_THEMES = { japan, mexico, portugal };

const GENERATED_PALETTES = [
  makeTheme({ name: "Lagoon", paper: "#F4FBFA", ink: "#0F3D4C", sky: "#CDEFEA", terracotta: "#E86A4A", gold: "#F2B544", teal: "#1FA3A0", pink: "#F29BB0" }),
  makeTheme({ name: "Spice", paper: "#FFF4E8", ink: "#4A1D1F", sky: "#FAD6B8", terracotta: "#C8452B", gold: "#E9A23B", teal: "#4F8A6B", pink: "#E88A7D" }),
  makeTheme({ name: "Orchid", paper: "#FBF5FF", ink: "#2D1B54", sky: "#E6D4FA", terracotta: "#E9627A", gold: "#F5B83D", teal: "#3AA8A0", pink: "#F29CC8" }),
  makeTheme({ name: "Meadow", paper: "#F6FBEF", ink: "#1F3B2A", sky: "#D5EBC4", terracotta: "#E4663B", gold: "#EFC03C", teal: "#2E9E7A", pink: "#F2A3A0" }),
  makeTheme({ name: "Dusk", paper: "#FFF7F3", ink: "#2B2A5E", sky: "#F8D2E0", terracotta: "#E5604F", gold: "#F4B545", teal: "#3FA39A", pink: "#F08BB4" }),
  makeTheme({ name: "Desert", paper: "#FFF8EA", ink: "#3F2A18", sky: "#F6DDB1", terracotta: "#D2582C", gold: "#E8A720", teal: "#2F8F83", pink: "#E98E78" }),
];

function simplify(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Turns "New Zealand" into "new-zealand".
function makeId(name) {
  return simplify(name).replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}

// Adds up the letters of the id, then uses the total to pick a palette.
function pickGeneratedTheme(id) {
  let total = 0;
  for (const letter of id) total += letter.charCodeAt(0);
  return GENERATED_PALETTES[total % GENERATED_PALETTES.length];
}

export const DESTINATIONS = COUNTRY_NAMES.map((name) => {
  const id = makeId(name);
  return { id, name, theme: HAND_MADE_THEMES[id] || pickGeneratedTheme(id) };
});

//  shown before someone starts typing.
export const POPULAR_IDS = ["japan", "mexico", "portugal", "italy"];

// Find one destination by its id. Returns undefined if there is none.
export function findDestination(id) {
  return DESTINATIONS.find((destination) => destination.id === id);
}

// starts with the letters searched first, then any that contain the letters. Returns at most 6 results.
export function searchDestinations(text) {
  const query = simplify(text.trim());
  if (!query) return [];

  const startsWith = [];
  const contains = [];
  for (const destination of DESTINATIONS) {
    const name = simplify(destination.name);
    if (name.startsWith(query)) startsWith.push(destination);
    else if (name.includes(query)) contains.push(destination);
  }
  return [...startsWith, ...contains].slice(0, 6);
}