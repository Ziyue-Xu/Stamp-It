
function lighten(color, percent) {
  return `color-mix(in srgb, ${color} ${percent}%, white)`;
}

export function makeTheme({ name, paper, ink, sky, terracotta, gold, teal, pink }) {
  return {
    name,
    paper,
    ink,
    inkSoft: lighten(ink, 75),
    sky,
    terracotta,
    gold,
    teal,
    pink,
    goldSoft: lighten(gold, 30),
    tealSoft: lighten(teal, 25),
    greenSoft: lighten(teal, 15),
  };
}