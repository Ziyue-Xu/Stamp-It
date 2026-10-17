
const FIELD_LABELS = {
  budgetTier: "Budget",
  morningRoutine: "Morning start",
  tripPace: "Pace",
  dietaryNeeds: "Food needs",
  activityFocus: "Activities",
  attractionPopularity: "Hidden gems or hotspots",
  accommodationStyle: "Where to stay",
  transportMode: "Getting around",
};


function labelFor(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const spaced = field.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}


function noteFromWarning(text) {
  const clean = String(text).replace(/^WARNING:\s*/i, "").trim();
  const match = clean.match(
    /Not everybody's (\w+) matches \(([^)]*)\)\.\s*(?:A compromise is needed\.)?\s*([\s\S]*)/i
  );
  if (!match) return { label: "Group note", detail: "", resolution: clean };
  return {
    label: labelFor(match[1]),
    detail: "Your group answered: " + match[2],
    resolution: match[3].trim(),
  };
}


function splitTitle(text) {
  const clean = String(text || "Your itinerary");
  const at = clean.indexOf(":");
  if (at === -1) return { title: clean, subtitle: "" };
  return { title: clean.slice(0, at).trim(), subtitle: clean.slice(at + 1).trim() };
}


function sumCosts(items) {
  let amount = 0;
  let currency = "";
  items.forEach((item) => {
    if (item.cost) {
      amount += item.cost.amount;
      currency = currency || item.cost.currency;
    }
  });
  return currency ? { amount, currency } : null;
}

function itemFromBackend(raw) {
  const transit = raw.transit_details
    ? {
        mode: raw.transit_details.mode || "",
        line: raw.transit_details.provider_or_line || "",
        km: raw.transit_details.distance_km ?? null,
      }
    : null;
  const cost = raw.estimated_cost
    ? { amount: Number(raw.estimated_cost.amount) || 0, currency: raw.estimated_cost.currency || "EUR" }
    : null;
  return {
    id: raw.id,
    type: raw.item_type || "activity",
    title: raw.title || "",
    start: raw.start_time || "",
    end: raw.end_time || "",
    minutes: raw.duration_minutes ?? null,
    place: raw.location ? raw.location.name || "" : "",
    address: raw.location ? raw.location.address || "" : "",
    transit,
    tips: Array.isArray(raw.notes_and_tips) ? raw.notes_and_tips : [],
    cost,
  };
}

export function planFromBackend(data) {
  const { title, subtitle } = splitTitle(data.trip_title);
  const days = (data.days || []).map((rawDay) => {
    const items = (rawDay.timeline || []).map(itemFromBackend);
    return {
      dayNumber: rawDay.day_number,
      date: rawDay.date,
      city: rawDay.base_city || "",
      theme: rawDay.day_theme_or_summary || "",
      total: sumCosts(items),
      items,
    };
  });


  const cities = [];
  days.forEach((day) => {
    const last = cities[cities.length - 1];
    if (last && last.name === day.city) last.days += 1;
    else cities.push({ name: day.city, days: 1 });
  });

  const allItems = days.flatMap((day) => day.items);
  return {
    title,
    subtitle,
    startDate: data.start_date,
    endDate: data.end_date,
    cities,
    total: sumCosts(allItems),
    notes: (data.warnings || []).map(noteFromWarning),
    days,
  };
}


export function formatMoney(amount, currency) {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "EUR",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch (problem) {
    return `${amount} ${currency}`;
  }
}