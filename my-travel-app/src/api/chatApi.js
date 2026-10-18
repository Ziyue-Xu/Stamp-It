function negotiationPath(familyId) {
  return (
    `/travel/families/${encodeURIComponent(familyId)}/negotiations`
  );
}

async function requestNegotiation(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The negotiation service returned an invalid response.");
  }
  if (!response.ok) {
    const error = new Error(
      data.error || data.message || "The negotiation service could not respond."
    );
    error.status = response.status;
    throw error;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The negotiation service returned an invalid response.");
  }
  return data;
}

export function getNegotiationStatus(familyId) {
  return requestNegotiation(`${negotiationPath(familyId)}/status`);
}

export function createNegotiationRequest({
  familyId,
  preference,
  targetUserId,
  idempotencyKey,
}) {
  return requestNegotiation(`${negotiationPath(familyId)}/requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ preference, targetUserId }),
  });
}

export function respondToNegotiationRequest({ familyId, requestId, answer }) {
  return requestNegotiation(
    `${negotiationPath(familyId)}/${encodeURIComponent(requestId)}/respond`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    }
  );
}
