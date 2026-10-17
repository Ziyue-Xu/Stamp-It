function randomId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
}

export function canSplitStop(item) {
  return item.type === "activity" || item.type === "meal";
}

export function splitStopOf(item) {
  return item.type === "split" ? item.groups[0].items[0] : item;
}

export function splitOffStop(items, stopId, alternative, person) {
  const stop = items.find((item) => item.id === stopId);
  if (!stop || !canSplitStop(stop)) return items;
  const originalId = "orig-" + stop.id;
  const alternativeId = randomId("alt");
  const split = {
    id: "split-" + stop.id,
    type: "split",
    origin: "stop",
    title: stop.title,
    start: stop.start,
    end: stop.end,
    minutes: stop.minutes,
    place: "",
    address: "",
    transit: null,
    tips: [],
    cost: stop.cost,
    addedBy: null,
    regroup: null,
    defaultGroup: originalId,
    picks: { [person.userId]: alternativeId },
    groups: [
      {
        id: originalId,
        kind: "original",
        label: "",
        ownerId: null,
        ownerName: "",
        members: [],
        items: [stop],
      },
      {
        id: alternativeId,
        kind: "alt",
        label: "",
        ownerId: person.userId,
        ownerName: person.name,
        members: [],
        items: [alternative],
      },
    ],
  };
  return items.map((item) => (item.id === stopId ? split : item));
}

export function addAlternativeTrack(items, splitId, alternative, person) {
  const split = items.find((item) => item.id === splitId);
  if (!split || split.origin !== "stop") return items;
  if (split.groups.some((group) => group.ownerId === person.userId)) return items;
  const alternativeId = randomId("alt");
  const updated = {
    ...split,
    picks: { ...(split.picks || {}), [person.userId]: alternativeId },
    groups: [
      ...split.groups,
      {
        id: alternativeId,
        kind: "alt",
        label: "",
        ownerId: person.userId,
        ownerName: person.name,
        members: [],
        items: [alternative],
      },
    ],
  };
  return items.map((item) => (item.id === splitId ? updated : item));
}

export function removeAlternativeTrack(items, splitId, groupId, userId) {
  const split = items.find((item) => item.id === splitId);
  if (!split || split.origin !== "stop") return items;
  const target = split.groups.find((group) => group.id === groupId);
  if (!target || target.ownerId !== userId) return items;

  const groups = split.groups.filter((group) => group.id !== groupId);
  if (groups.length === 1) {
    return items.map((item) => (item.id === splitId ? groups[0].items[0] : item));
  }

  const picks = {};
  Object.keys(split.picks || {}).forEach((key) => {
    if (split.picks[key] !== groupId) picks[key] = split.picks[key];
  });
  return items.map((item) => (item.id === splitId ? { ...split, groups, picks } : item));
}

export function pickTrack(items, splitId, groupId, userId) {
  const split = items.find((item) => item.id === splitId);
  if (!split) return items;
  const picked = { ...split, picks: { ...(split.picks || {}), [userId]: groupId } };
  const nextItems = items.map((item) => (item.id === splitId ? picked : item));
  if (split.origin !== "stop") return nextItems;

  const abandoned = split.groups.find(
    (group) =>
      group.kind === "alt" &&
      group.ownerId === userId &&
      group.id !== groupId &&
      !Object.keys(picked.picks).some((key) => key !== userId && picked.picks[key] === group.id)
  );
  if (!abandoned) return nextItems;
  return removeAlternativeTrack(nextItems, splitId, abandoned.id, userId);
}