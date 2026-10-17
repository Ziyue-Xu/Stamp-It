

import "./QuestionIcon.css";

const INK = "var(--ink)";


const ICONS = {
  tripPace: (
    <>
      <path d="M10 44a22 22 0 0 1 44 0" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <path d="M32 44l11-14" stroke="var(--terracotta)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="44" r="5" fill={INK} />
    </>
  ),
  budgetTier: (
    <>
      <circle cx="32" cy="32" r="22" fill="var(--gold)" stroke={INK} strokeWidth="4" />
      <text x="32" y="41" textAnchor="middle" fontSize="26" fontWeight="900" fill={INK}>$</text>
    </>
  ),
  dietaryRestrictions: (
    <>
      <path d="M12 52C12 26 30 12 52 12c0 24-14 40-40 40z" fill="var(--teal)" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M12 52L34 30" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  groundTransportation: (
    <>
      <path d="M8 40v-8l8-12h28l8 12v8z" fill="var(--terracotta)" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <circle cx="20" cy="42" r="7" fill={INK} />
      <circle cx="44" cy="42" r="7" fill={INK} />
    </>
  ),
  activityFocus: (
    <>
      <circle cx="46" cy="20" r="7" fill="var(--gold)" />
      <path d="M6 52L24 22l12 18 8-10 14 22z" fill="var(--teal)" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
    </>
  ),
  attractionPopularity: (
    <>
      <path d="M32 8l22 14-22 34L10 22z" fill="var(--teal)" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M10 22h44M24 22l8 34M40 22l-8 34" fill="none" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    </>
  ),
  diningCuisine: (
    <>
      <path d="M8 30h48a24 24 0 0 1-48 0z" fill="var(--gold)" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M24 10c-4 4 4 6 0 12M40 10c-4 4 4 6 0 12" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  morningRoutine: (
    <>
      <path d="M12 44a20 20 0 0 1 40 0z" fill="var(--gold)" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M4 48h56M32 10v8M12 20l6 6M52 20l-6 6" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  interestedInShopping: (
    <>
      <rect x="12" y="24" width="40" height="30" rx="6" fill="var(--pink)" stroke={INK} strokeWidth="4" />
      <path d="M22 24v-4a10 10 0 0 1 20 0v4" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  travelStyle: (
    <>
      <circle cx="32" cy="32" r="22" fill="#fff" stroke={INK} strokeWidth="4" />
      <path d="M32 16l8 16-8 16-8-16z" fill="var(--terracotta)" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    </>
  ),
  tourPreference: (
    <>
      <path d="M16 10v46" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <path d="M16 12h34l-8 10 8 10H16z" fill="var(--terracotta)" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
    </>
  ),
  luggagePreference: (
    <>
      <rect x="8" y="22" width="48" height="32" rx="8" fill="var(--terracotta)" stroke={INK} strokeWidth="4" />
      <path d="M24 22v-6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6" fill="none" stroke={INK} strokeWidth="4" />
      <path d="M22 22v32M42 22v32" stroke="var(--sky)" strokeWidth="5" />
    </>
  ),
  petFriendly: (
    <>
      <ellipse cx="32" cy="42" rx="13" ry="11" fill="var(--gold)" stroke={INK} strokeWidth="4" />
      <circle cx="14" cy="30" r="6" fill="var(--gold)" stroke={INK} strokeWidth="3" />
      <circle cx="25" cy="18" r="6" fill="var(--gold)" stroke={INK} strokeWidth="3" />
      <circle cx="39" cy="18" r="6" fill="var(--gold)" stroke={INK} strokeWidth="3" />
      <circle cx="50" cy="30" r="6" fill="var(--gold)" stroke={INK} strokeWidth="3" />
    </>
  ),
};

function QuestionIcon({ field, small = false }) {
  return (
    <div className={"qicon" + (small ? " qicon-small" : "")} aria-hidden="true">
      <svg viewBox="0 0 64 64">{ICONS[field]}</svg>
    </div>
  );
}

export default QuestionIcon;