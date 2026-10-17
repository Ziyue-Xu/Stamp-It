

import { USE_REAL_BACKEND, API_BASE_URL } from "./config";
import {
  toBackendDateTime,
  fromBackendDateTime,
  countryNameFor,
  destinationIdFor,
} from "./familyFormat";


const TRIPS_KEY = "travelAppTrips";


function readTrips() {
  return JSON.parse(localStorage.getItem(TRIPS_KEY) || "[]");
}

function writeTrips(trips) {
  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
}


function replaceTrip(updatedTrip) {
  const trips = readTrips().map((trip) =>
    trip.tripCode === updatedTrip.tripCode ? updatedTrip : trip
  );
  writeTrips(trips);
}


async function readErrorMessage(response, fallback) {
  try {
    const data = await response.json();
    return data.error || data.message || fallback;
  } catch (error) {
    return fallback;
  }
}

function tripFromBackend(data) {
  const start = fromBackendDateTime(data.startDate);
  const end = fromBackendDateTime(data.endDate);
  return {
    tripCode: data.family_code,
    familyId: data.family_code,
    destinationId: destinationIdFor(data.country),
    startDate: start.date,
    endDate: end.date,
    arrivalTime: start.time,
    departureTime: end.time,
    members: (data.users || []).map((user) => ({
      userId: user.userProfile.userId,
      name: user.userProfile.name,
      email: user.userProfile.email,
    })),
  };
}



function makeFakeCode() {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += Math.floor(Math.random() * 10);
  }
  return code;
}


export async function createTrip({
  destinationId,
  startDate,
  endDate,
  arrivalTime = "",
  departureTime = "",
}) {
  if (USE_REAL_BACKEND) {

    const response = await fetch(`${API_BASE_URL}/families`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: countryNameFor(destinationId),
        startDate: toBackendDateTime(startDate, arrivalTime),
        endDate: toBackendDateTime(endDate, departureTime),
      }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "The server could not create the trip."));
    }
    // The backend answers with, for example:
    //   { "family_code": "4821" }
    const data = await response.json();
    return {
      tripCode: data.family_code,
      familyId: data.family_code,
      destinationId: destinationId,
      startDate: startDate,
      endDate: endDate,
      arrivalTime: arrivalTime,
      departureTime: departureTime,
      members: [],
    };
  }


  const trip = {
    tripCode: makeFakeCode(),
    familyId: "fake-family-" + Date.now(),
    destinationId: destinationId,
    startDate: startDate,
    endDate: endDate,
    arrivalTime: arrivalTime,
    departureTime: departureTime,
    members: [],
  };
  writeTrips([...readTrips(), trip]);
  return trip;
}


export async function findTripByCode(code) {
  if (USE_REAL_BACKEND) {
    // ===== REAL BRANCH =====
    const response = await fetch(`${API_BASE_URL}/families/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_code: code }),
    });
    if (!response.ok) {
      throw new Error(
        await readErrorMessage(response, "That family code was not found. Check it and try again.")
      );
    }

    const data = await response.json();
    return tripFromBackend({ ...data, family_code: code });
  }

  const found = readTrips().find((trip) => trip.tripCode === code);
  if (found) return found;
  throw new Error("That family code was not found. Check it and try again.");
}


export async function addMemberToTrip(trip, member) {
  const alreadyIn = trip.members.some((m) => m.userId === member.userId);
  const updatedTrip = alreadyIn
    ? trip
    : { ...trip, members: [...trip.members, member] };

  if (!USE_REAL_BACKEND) {
    replaceTrip(updatedTrip); // keep the fake list up to date
  }
  return updatedTrip;
}
// ------------------------------------------------------------------
// joinTrip(trip, member)
// WHEN IT'S CALLED: when someone who is ALREADY SIGNED IN creates a
//                   second trip or joins one (no sign-up needed).
// SENDS (real):     { family_code: "4821", userId: "..." }
// RETURNS:          the trip with this member added.
// NOTE FOR THE BACKEND: this should be safe to call twice for the same
//       person (joining a trip you're already in should not break).
// ------------------------------------------------------------------
export async function joinTrip(trip, member) {
  if (USE_REAL_BACKEND) {
    // ===== REAL BRANCH =====
    const response = await fetch(`${API_BASE_URL}/families/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_code: trip.tripCode, userId: member.userId }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Could not join the trip."));
    }
  }
  // Fake mode and real mode both update our local copy of the trip.
  return addMemberToTrip(trip, member);
}
// ------------------------------------------------------------------
// getMyTrips(userId)
// WHEN IT'S CALLED: whenever the dashboard is about to show.
// SENDS (real):     the userId in the web address.
// RETURNS:          a list of trips this person is in.
//
// NOTE: the backend has no avatar field, so members coming from the
// real backend won't have an avatar. The dashboard handles that by
// falling back to a default color.
// ------------------------------------------------------------------
export async function getMyTrips(userId) {
  if (USE_REAL_BACKEND) {
    // ===== REAL BRANCH =====
    const response = await fetch(
      `${API_BASE_URL}/users/${encodeURIComponent(userId)}/families`
    );
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Could not load your trips."));
    }

    const list = await response.json();
    return list.map(tripFromBackend);
  }


  return readTrips().filter((trip) =>
    trip.members.some((member) => member.userId === userId)
  );
}

export async function updateTrip(trip, changes, userId) {
  if (getCreatorId(trip) !== userId) {
    throw new Error("Only the trip creator can change the trip details.");
  }

  const updatedTrip = {
    ...trip,
    destinationId: changes.destinationId,
    startDate: changes.startDate,
    endDate: changes.endDate,
    arrivalTime: changes.arrivalTime,
    departureTime: changes.departureTime,
  };

  if (USE_REAL_BACKEND) {
    // ===== REAL BRANCH =====
    const response = await fetch(
      `${API_BASE_URL}/families/${encodeURIComponent(trip.familyId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId,
          country: countryNameFor(changes.destinationId),
          startDate: toBackendDateTime(changes.startDate, changes.arrivalTime),
          endDate: toBackendDateTime(changes.endDate, changes.departureTime),
        }),
      }
    );
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Could not update the trip."));
    }
    return updatedTrip;
  }

  // ===== FAKE BRANCH: check against the saved copy, then save =====
  const saved = readTrips().find((t) => t.tripCode === trip.tripCode);
  if (!saved || getCreatorId(saved) !== userId) {
    throw new Error("Only the trip creator can change the trip details.");
  }
  replaceTrip(updatedTrip);
  return updatedTrip;
}

export async function refreshMemberInTrips(member) {
  if (USE_REAL_BACKEND) return;

  const trips = readTrips().map((trip) => ({
    ...trip,
    members: trip.members.map((m) =>
      m.userId === member.userId
        ? { ...m, name: member.name, avatar: member.avatar }
        : m
    ),
  }));
  writeTrips(trips);
}

export function getCreatorId(trip) {
  if (trip.creatorId) return trip.creatorId;
  return trip.members.length > 0 ? trip.members[0].userId : null;
}