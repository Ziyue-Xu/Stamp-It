
export const AVATARS = [
  { id: "taj", label: "Taj Mahal", background: "#EFA3BB", text: "#2A2C48" },
  { id: "liberty", label: "Statue of Liberty", background: "#F2C25E", text: "#2A2C48" },
  { id: "eiffel", label: "Eiffel Tower", background: "#F2C25E", text: "#2A2C48" },
  { id: "fuji", label: "Mount Fuji", background: "#EFA3BB", text: "#2A2C48" },
  { id: "colosseum", label: "Colosseum", background: "#F2C25E", text: "#2A2C48" },
  { id: "parthenon", label: "Parthenon", background: "#4C87B3", text: "#F6EBCB" },
  { id: "mosque", label: "Blue Mosque", background: "#EFA3BB", text: "#2A2C48" },
  { id: "greatwall", label: "Great Wall", background: "#F6D88A", text: "#2A2C48" },
  { id: "sagrada", label: "Sagrada Familia", background: "#E9906B", text: "#2A2C48" },
  { id: "belem", label: "Belem Tower", background: "#7FA46B", text: "#2A2C48" },
];


const LEGACY_IDS = {
  terracotta: "sagrada",
  gold: "liberty",
  teal: "belem",
  pink: "taj",
  indigo: "parthenon",
};


export const AVATAR_COLORS = AVATARS;


function hashText(text) {
  let total = 0;
  for (const letter of String(text)) total += letter.charCodeAt(0);
  return total;
}


export function findAvatar(id, seed = "") {
  const wanted = LEGACY_IDS[id] || id;
  const found = AVATARS.find((avatar) => avatar.id === wanted);
  if (found) return found;
  if (seed) return AVATARS[hashText(seed) % AVATARS.length];
  return AVATARS[0];
}