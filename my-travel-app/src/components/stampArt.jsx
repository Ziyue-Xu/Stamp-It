
const PINK = "#EFA3BB";
const MUSTARD = "#F2C25E";
const CREAM = "#F6EBCB";
const NAVY = "#2A2C48";
const GREEN = "#6FA18A"; // verdigris (statue of liberty)
const ORANGE = "#E4603A";
const SEA = "#4C87B3";
const SAGE = "#7FA46B";
const SAND = "#F6D88A"; // light warm sky
const TERRA = "#E9906B"; // soft terracotta
const MINT = "#8FBFB4"; // soft sea-glass green


export function TajMahalArt() {
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={PINK} />
      <circle cx="82" cy="20" r="7" fill={CREAM} />
      <g stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" fill={CREAM}>
        {/* the long platform */}
        <rect x="8" y="94" width="84" height="8" />
        {/* two tall minarets on the outside */}
        <rect x="12" y="50" width="7" height="44" />
        <rect x="81" y="50" width="7" height="44" />
        <path d="M11 50 H20 L15.5 40 Z" />
        <path d="M80 50 H89 L84.5 40 Z" />
        {/* main building */}
        <rect x="28" y="66" width="44" height="28" />
        {/* two little domes beside the big one */}
        <path d="M31 66 V60 Q36 52 41 60 V66 Z" />
        <path d="M59 66 V60 Q64 52 69 60 V66 Z" />
        {/* the big onion dome */}
        <rect x="40" y="58" width="20" height="8" />
        <path d="M40 58 C34 46 42 34 50 28 C58 34 66 46 60 58 Z" />
        <path d="M50 28 V16" />
        <circle cx="50" cy="15" r="2" fill={NAVY} />
      </g>
      {/* the big arched doorway */}
      <path d="M43 94 V80 Q50 68 57 80 V94 Z" fill={NAVY} />
      <path d="M32 94 V82 Q36 76 40 82 V94 Z M60 94 V82 Q64 76 68 82 V94 Z" fill={NAVY} />
      {/* reflecting pool */}
      <rect y="102" width="100" height="28" fill={SEA} />
      <g stroke={CREAM} strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M14 110 H34 M44 110 H58 M70 110 H88" />
        <path d="M24 118 H44 M54 118 H76" />
        <path d="M16 125 H30 M40 125 H60 M68 125 H84" />
      </g>
    </svg>
  );
}

// STATUE OF LIBERTY 
export function LibertyArt() {
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={MUSTARD} />
     
      <path d="M70 6 C64 12 64 18 70 22 C76 18 76 12 70 6 Z" fill={ORANGE} />
      <g stroke={NAVY} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
       //the base
        <path d="M30 128 H70 V118 H66 L64 100 H36 L34 118 H30 Z" fill={CREAM} />
        <path d="M36 108 H64" fill="none" />
        //the robe
        <path d="M36 100 L40 58 H60 L64 100 Z" fill={GREEN} />
        <path d="M44 62 L42 98 M50 62 V98 M56 62 L58 98" fill="none" strokeWidth="1.2" />
        //torch
        <path d="M58 62 L68 44 L70 28" fill="none" strokeWidth="7" stroke={GREEN} />
        <path d="M58 62 L68 44 L70 28" fill="none" strokeWidth="1.6" stroke={NAVY} strokeOpacity="0" />
       /torch outline
        <path d="M65 28 H75 L73 22 H67 Z" fill={CREAM} />
        //tablet
        <rect x="31" y="68" width="10" height="15" fill={CREAM} transform="rotate(-12 36 75)" />
        // head and crown
        <circle cx="50" cy="50" r="7.5" fill={GREEN} />
        <path d="M50 41 V30 M43 43 L36 34 M57 43 L64 34 M40 48 L31 44 M60 48 L69 44" fill="none" strokeWidth="2.6" />
      </g>
    </svg>
  );
}

// eiffel
export function EiffelArt() {
  return (
    <svg viewBox="0 0 112 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="112" height="150" fill="#F2C25E" />
      <rect x="8" y="8" width="96" height="134" rx="44" fill="#F6D88A" />
      <g fill={NAVY}>
        {/* the tower's outline */}
        <path d="M56 12 L52 58 L46 58 L41 96 L28 138 L42 138 L48 116 Q56 104 64 116 L70 138 L84 138 L71 96 L66 58 L60 58 Z" />
        {/* the two platforms */}
        <rect x="42" y="56" width="28" height="5" />
        <rect x="35" y="94" width="42" height="6" />
      </g>
      {/* the arch under the first platform + iron "X" cross-bars (cut out in light color) */}
      <path d="M46 102 H66 L68 112 Q56 100 44 112 Z" fill="#F6D88A" />
      <g stroke="#F6D88A" strokeWidth="1.8" fill="none">
        <path d="M53 22 V54 M59 22 V54" strokeWidth="1.2" />
        <path d="M46 66 L66 90 M66 66 L46 90" />
      </g>
      <path d="M12 140 H100" stroke={NAVY} strokeWidth="3" />
    </svg>
  );
}

// -chapel
export function ChapelArt() {
  return (
    <svg viewBox="0 0 62 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g stroke={NAVY} strokeWidth="1.4" strokeLinejoin="round">
        {/* cross on top */}
        <path d="M31 4 V16 M27 8 H35" fill="none" strokeWidth="2" />
        {/* steeple */}
        <path d="M31 16 L38 38 H24 Z" fill={CREAM} />
        <rect x="24" y="38" width="14" height="14" fill={CREAM} />
        <path d="M28 52 V44 Q31 40 34 44 V52 Z" fill={NAVY} />
        {/* church body + roof */}
        <rect x="8" y="52" width="46" height="26" fill={CREAM} />
        <path d="M5 54 L31 46 L57 54 Z" fill={ORANGE} />
        {/* door + windows */}
        <path d="M26 78 V66 Q31 60 36 66 V78 Z" fill={NAVY} />
        <path d="M13 70 V63 Q16 59 19 63 V70 Z M43 70 V63 Q46 59 49 63 V70 Z" fill={NAVY} />
      </g>
      <rect x="2" y="78" width="58" height="6" fill={NAVY} />
    </svg>
  );
}

// mount fuji
export function FujiArt() {
  return (
    <svg viewBox="0 0 136 82" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="136" height="82" fill={PINK} />
      <circle cx="104" cy="24" r="9" fill={ORANGE} />
      <path d="M14 66 L52 28 Q68 14 84 28 L122 66 Z" fill={NAVY} />
      <path d="M52 28 Q68 14 84 28 L79 33 L73 28 L68 36 L62 28 L57 34 Z" fill={CREAM} />
      <rect y="60" width="136" height="22" fill={SEA} />
      <g stroke={CREAM} strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M12 68 H40 M52 68 H80 M92 68 H124" />
        <path d="M26 75 H58 M70 75 H104" />
      </g>
    </svg>
  );
}

// COLOSSEUM
export function ColosseumArt() {
  const topArches = [14, 26, 38, 50, 62, 74];
  const midArches = [14, 26, 38, 50, 62, 74];
  const lowArches = [13, 26, 39, 52, 65, 78];
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={MUSTARD} />
      <circle cx="22" cy="24" r="6" fill={CREAM} />
      {/* the stone ring */}
      <g stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round">
        <path d="M6 108 V58 Q6 50 14 48 L86 48 Q94 50 94 58 V108 Z" fill={CREAM} />
        {/* floor lines between the rows of arches */}
        <path d="M6 70 H94 M6 89 H94" fill="none" />
      </g>
      {/* the broken top-right corner (cut out so it looks ruined) */}
      <path d="M62 46 L72 54 L78 50 L84 60 L94 56 V44 Z" fill={MUSTARD} />
      <path d="M62 48 L72 54 L78 50 L84 60 L94 56" fill="none" stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" />
      {/* arches, top row (the broken corner has fewer) */}
      <g fill={NAVY}>
        {topArches.map((x, i) =>
          i < 4 ? <path key={"t" + x} d={`M${x - 3.5} 70 V60 Q${x} 54 ${x + 3.5} 60 V70 Z`} /> : null
        )}
        {midArches.map((x) => (
          <path key={"m" + x} d={`M${x - 3.5} 89 V77 Q${x} 71 ${x + 3.5} 77 V89 Z`} />
        ))}
        {lowArches.map((x) => (
          <path key={"l" + x} d={`M${x - 4} 108 V96 Q${x} 89 ${x + 4} 96 V108 Z`} />
        ))}
      </g>
      <rect y="108" width="100" height="22" fill={SAGE} />
      <path d="M0 108 H100" stroke={NAVY} strokeWidth="1.6" />
    </svg>
  );
}

// PARTHENON
export function ParthenonArt() {
  const columns = [15, 25, 35, 45, 55, 65, 75];
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={SEA} />
      <circle cx="80" cy="20" r="6" fill={CREAM} />
      <g stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round">
        {/* triangle roof (pediment) + the beam under it */}
        <path d="M8 56 L50 32 L92 56 Z" fill={CREAM} />
        <path d="M22 53 L50 38 L78 53 Z" fill={SEA} strokeWidth="1.2" />
        <rect x="8" y="56" width="84" height="7" fill={CREAM} />
        {/* the columns */}
        {columns.map((x) => (
          <rect key={x} x={x} y="63" width="8" height="36" fill={CREAM} />
        ))}
        {/* three steps */}
        <rect x="6" y="99" width="88" height="6" fill={CREAM} />
        <rect x="3" y="105" width="94" height="6" fill={CREAM} />
      </g>
      {/* column grooves */}
      <g stroke={NAVY} strokeWidth="0.9" fill="none">
        {columns.map((x) => (
          <path key={"g" + x} d={`M${x + 2.7} 65 V97 M${x + 5.3} 65 V97`} />
        ))}
      </g>
      {/* rocky hill */}
      <path d="M0 111 H100 V130 H0 Z" fill={NAVY} />
      <path d="M0 118 C20 114 40 120 60 116 S88 116 100 118" fill="none" stroke={SAGE} strokeWidth="2" />
    </svg>
  );
}

// MOSQUE Istanbul 
export function BlueMosqueArt() {
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={PINK} />
      {/* small crescent moon in the sky */}
      <path d="M80 14 a8 8 0 1 0 6 12 a6.5 6.5 0 1 1 -6 -12 Z" fill={CREAM} />
      <g stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" fill={CREAM}>
        {/* two thin minarets */}
        <rect x="10" y="44" width="6" height="58" />
        <rect x="84" y="44" width="6" height="58" />
        <path d="M9 44 H17 L13 28 Z" />
        <path d="M83 44 H91 L87 28 Z" />
        <rect x="8" y="60" width="10" height="3" />
        <rect x="82" y="60" width="10" height="3" />
        {/* main building */}
        <rect x="24" y="76" width="52" height="26" />
        {/* two half-domes beside the big dome */}
        <path d="M24 76 Q24 62 38 62 V76 Z" />
        <path d="M76 76 Q76 62 62 62 V76 Z" />
        {/* the big dome */}
        <path d="M32 76 C32 40 68 40 68 76 Z" />
        <path d="M50 44 V34" fill="none" />
      </g>
      <circle cx="50" cy="32" r="2.4" fill={NAVY} />
      {/* windows + door */}
      <g fill={NAVY}>
        <path d="M43 72 V62 Q50 56 57 62 V72 Z" />
        <path d="M28 98 V88 Q31.5 83 35 88 V98 Z M65 98 V88 Q68.5 83 72 88 V98 Z" />
        <path d="M45 102 V90 Q50 83 55 90 V102 Z" />
      </g>
      {/* ground + water */}
      <rect y="102" width="100" height="28" fill={SEA} />
      <g stroke={CREAM} strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M12 110 H34 M46 110 H60 M72 110 H90" />
        <path d="M22 118 H44 M54 118 H78" />
        <path d="M14 125 H30 M40 125 H62 M70 125 H86" />
      </g>
    </svg>
  );
}

// GREAT WALL OF CHINA
export function GreatWallArt() {
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={SAND} />
      <circle cx="78" cy="22" r="7" fill={ORANGE} />
      {/* far mountains */}
      <path d="M0 70 L22 40 L40 62 L60 34 L100 78 V130 H0 Z" fill={MINT} />
      {/* near green hill */}
      <path d="M0 96 C20 84 40 92 62 80 S90 78 100 84 V130 H0 Z" fill={SAGE} />
      <g stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" fill={CREAM}>
        {/* the wall climbing the hill (a thick slanted band) */}
        <path d="M0 112 L28 100 L52 86 L74 74 L100 64 V78 L74 90 L52 102 L28 114 L0 126 Z" />
        {/* little teeth along the top edge */}
        <path d="M6 110 v-4 h4 v2 M16 106 v-4 h4 v2 M34 97 v-4 h4 v2 M44 91 v-4 h4 v2 M80 71 v-4 h4 v2 M90 67 v-4 h4 v2" fill="none" />
        {/* watchtower 1 (front) */}
        <rect x="52" y="64" width="22" height="26" />
        <path d="M49 64 H77 L72 56 H54 Z" fill={ORANGE} />
        <path d="M57 90 V78 Q63 72 69 78 V90 Z" fill={NAVY} stroke="none" />
        {/* watchtower 2 (small, far away) */}
        <rect x="14" y="80" width="14" height="16" />
        <path d="M12 80 H30 L27 74 H15 Z" fill={ORANGE} />
        <path d="M18 96 V88 Q21 84 24 88 V96 Z" fill={NAVY} stroke="none" />
      </g>
      {/* brick lines on the wall */}
      <g stroke={NAVY} strokeWidth="0.9" fill="none">
        <path d="M30 108 L50 98 M56 98 L72 88 M78 84 L96 76" />
      </g>
    </svg>
  );
}

//  SAGRADA FAMILIA,
export function SagradaArt() {
  // x = middle of each spire, top = where its point starts
  const spires = [
    { x: 16, top: 52 },
    { x: 33, top: 34 },
    { x: 50, top: 12 },
    { x: 67, top: 34 },
    { x: 84, top: 52 },
  ];
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={TERRA} />
      <g stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" fill={CREAM}>
        {/* the building the spires stand on */}
        <rect x="6" y="94" width="88" height="20" />
        {spires.map((s) => (
          <g key={s.x}>
            <path d={`M${s.x - 6} 94 V${s.top + 22} Q${s.x} ${s.top} ${s.x + 6} ${s.top + 22} V94 Z`} />
            <circle cx={s.x} cy={s.top + 1} r="2.6" fill={MUSTARD} />
          </g>
        ))}
      </g>
      {/* little window slits on each spire */}
      <g fill={NAVY}>
        {spires.map((s) => (
          <g key={"w" + s.x}>
            <rect x={s.x - 1.2} y={s.top + 28} width="2.4" height="9" rx="1.2" />
            <rect x={s.x - 1.2} y={s.top + 44} width="2.4" height="9" rx="1.2" />
            <rect x={s.x - 1.2} y={s.top + 60 > 90 ? 84 : s.top + 60} width="2.4" height="6" rx="1.2" />
          </g>
        ))}
        {/* three doorways */}
        <path d="M22 114 V102 Q28 95 34 102 V114 Z M44 114 V100 Q50 92 56 100 V114 Z M66 114 V102 Q72 95 78 102 V114 Z" />
      </g>
      <rect y="114" width="100" height="16" fill={NAVY} />
    </svg>
  );
}

//  BELEM TOWER
export function BelemArt() {
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={SAGE} />
      <circle cx="20" cy="24" r="6" fill={CREAM} />
      <g stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" fill={CREAM}>
        {/* the low wall at the bottom */}
        <rect x="14" y="98" width="72" height="12" />
        {/* main tower */}
        <rect x="32" y="48" width="36" height="50" />
        {/* top section with little teeth */}
        <rect x="36" y="32" width="28" height="16" />
        <path d="M36 32 v-4 h5 v4 M45 32 v-4 h5 v4 M54 32 v-4 h5 v4 M59 32 v-4 h5 v4" fill="none" />
        {/* two corner lookout turrets with domes */}
        <rect x="24" y="58" width="10" height="20" />
        <path d="M23 58 H35 Q29 46 23 58 Z" fill={ORANGE} />
        <rect x="66" y="58" width="10" height="20" />
        <path d="M65 58 H77 Q71 46 65 58 Z" fill={ORANGE} />
        {/* cross at the very top */}
        <path d="M50 28 V18 M46 22 H54" fill="none" strokeWidth="2" />
      </g>
      {/* windows + big door */}
      <g fill={NAVY}>
        <path d="M44 68 V58 Q50 52 56 58 V68 Z" />
        <path d="M44 98 V82 Q50 74 56 82 V98 Z" />
        <path d="M27 76 V66 Q29 63 31 66 V76 Z M69 76 V66 Q71 63 73 66 V76 Z" />
        <rect x="46" y="38" width="8" height="6" rx="3" />
      </g>
      {/* river */}
      <rect y="110" width="100" height="20" fill={SEA} />
      <g stroke={CREAM} strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M10 117 H32 M44 117 H60 M72 117 H92" />
        <path d="M20 124 H42 M52 124 H78" />
      </g>
    </svg>
  );
}

//these are ink stamps

// CATHEDRAL (Notre-Dame)
export function CathedralInk() {
  return (
    <svg viewBox="0 0 110 100" aria-hidden="true" style={{ width: "100%", height: "100%" }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        {/* two towers with little arched openings */}
        <path d="M10 92 V32 H38 V92" />
        <path d="M72 92 V32 H100 V92" />
        <path d="M10 32 H14 V27 H18 V32 H22 V27 H26 V32 H30 V27 H34 V32 H38" />
        <path d="M72 32 H76 V27 H80 V32 H84 V27 H88 V32 H92 V27 H96 V32 H100" />
        <path d="M18 56 V44 a4 4 0 0 1 8 0 V56 Z M84 56 V44 a4 4 0 0 1 8 0 V56 Z" />
        {/* middle part with the pointed spire */}
        <path d="M38 92 V50 H72 V92" />
        <path d="M46 50 L55 18 L64 50" />
        {/* rose window */}
        <circle cx="55" cy="64" r="9" />
        <path d="M55 55 V73 M46 64 H64 M49 58 L61 70 M61 58 L49 70" strokeWidth="1.2" />
        {/* three pointed doors */}
        <path d="M14 92 V78 L18 72 L22 78 V92 M48 92 V82 L55 74 L62 82 V92 M88 92 V78 L92 72 L96 78 V92" strokeWidth="1.5" />
        <path d="M4 92 H106" />
      </g>
      <text x="2" y="12" fontFamily="Special Elite, monospace" fontSize="9" fill="currentColor" letterSpacing="2">PARIS</text>
      <text x="108" y="12" textAnchor="end" fontFamily="Special Elite, monospace" fontSize="9" fill="currentColor" letterSpacing="1.5">1163</text>
    </svg>
  );
}

//  BASILICA 
export function BasilicaInk() {
  return (
    <svg viewBox="0 0 110 90" aria-hidden="true" style={{ width: "100%", height: "100%" }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        {/* cross + dome */}
        <path d="M55 4 V14 M51 8 H59" />
        <path d="M40 40 C40 18 70 18 70 40" />
        <path d="M55 20 V36 M47 24 V37 M63 24 V37" strokeWidth="1.2" />
        <rect x="38" y="38" width="34" height="8" />
        {/* front with columns and a triangle roof */}
        <path d="M12 46 H98 L55 40 Z" />
        <rect x="12" y="46" width="86" height="6" />
        <path d="M18 52 V82 M30 52 V82 M42 52 V82 M68 52 V82 M80 52 V82 M92 52 V82" />
        <path d="M48 82 V66 a7 7 0 0 1 14 0 V82" />
        <path d="M6 82 H104 M10 86 H100" />
      </g>
      <text x="2" y="12" fontFamily="Special Elite, monospace" fontSize="9" fill="currentColor" letterSpacing="2">ROME</text>
      <text x="108" y="12" textAnchor="end" fontFamily="Special Elite, monospace" fontSize="9" fill="currentColor" letterSpacing="1.5">ITALY</text>
    </svg>
  );
}

// plain LANDSCAPE 
//      picture for any country that doesn't have its own landmark yet. ----
export function LandscapeArt() {
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="130" fill={PINK} />
      <circle cx="70" cy="34" r="12" fill={ORANGE} />
      <path d="M0 96 L30 56 L52 84 L72 62 L100 96 V130 H0 Z" fill={NAVY} />
      <path d="M0 108 C24 96 48 112 74 102 S92 100 100 104 V130 H0 Z" fill="#7FA46B" />
    </svg>
  );
}