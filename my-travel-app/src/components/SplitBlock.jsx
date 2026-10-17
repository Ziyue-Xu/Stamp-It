import { formatTime } from "../data/dates";
import { formatMoney } from "../api/planFormat";
import "./SplitBlock.css";

const KIND_LABELS = { activity: "DO", meal: "EAT", lodging: "STAY", transit: "GO" };

function formatMinutes(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "Someone";
}

function laneIdOf(item, userId) {
  const picked = item.picks && item.picks[userId];
  if (picked && item.groups.some((group) => group.id === picked)) return picked;
  const guess = item.groups.find((group) => group.members.some((m) => m.userId === userId));
  if (guess) return guess.id;
  if (item.defaultGroup && item.groups.some((group) => group.id === item.defaultGroup)) {
    return item.defaultGroup;
  }
  return null;
}

function everyone(item, members) {
  const seen = new Map();
  (members || []).forEach((m) => seen.set(m.userId, m.name));
  item.groups.forEach((group) =>
    group.members.forEach((m) => {
      if (!seen.has(m.userId)) seen.set(m.userId, m.name);
    })
  );
  return [...seen.entries()].map(([userId, name]) => ({ userId, name }));
}

function laneSummary(group) {
  const stops = group.items.filter((item) => item.type !== "transit");
  const last = group.items[group.items.length - 1];
  return { stopCount: stops.length, endsAt: last ? last.end : "" };
}

function LaneStop({ item }) {
  if (item.type === "transit") {
    return (
      <li className="split-stop split-stop-go">
        <span className="split-stop-time">{formatTime(item.start)}</span>
        <span className="split-stop-body">
          <span className="split-stop-title">{item.title}</span>
        </span>
      </li>
    );
  }
  const bits = [];
  if (item.minutes) bits.push(formatMinutes(item.minutes));
  if (item.cost && item.cost.amount > 0) bits.push(formatMoney(item.cost.amount, item.cost.currency));
  return (
    <li className="split-stop">
      <span className="split-stop-time">{formatTime(item.start)}</span>
      <span className="split-stop-body">
        <span className="split-stop-top">
          <span className={"split-kind split-kind-" + item.type}>
            {KIND_LABELS[item.type] || item.type.toUpperCase()}
          </span>
          {bits.length > 0 && <span className="split-stop-meta">{bits.join(" · ")}</span>}
        </span>
        <span className="split-stop-title">{item.title}</span>
        {item.address && <span className="split-stop-address">{item.address}</span>}
      </span>
    </li>
  );
}

function SplitBlock({ item, me, members, onPick, onSplitOff, onRemoveMine, splitting }) {
  const trackCount = item.groups.length;
  const regroup = item.regroup;

  const people = everyone(item, members);
  const myLane = laneIdOf(item, me);
  const myIndex = item.groups.findIndex((group) => group.id === myLane);
  const undecided = people.filter((person) => laneIdOf(item, person.userId) === null);
  const fromStop = item.origin === "stop";
  const iOwnATrack = item.groups.some((group) => group.ownerId === me);
  const canSplitOff = fromStop && onSplitOff && !iOwnATrack;

  return (
    <li className="plan-stop split-row">
      <div className="plan-stop-time">
        {formatTime(item.start)}
        {item.end && <span className="plan-stop-end">{"to " + formatTime(item.end)}</span>}
      </div>

      <div className="split-card">
        <div className="split-head">
          <span className="split-tag">SPLIT UP</span>
          <span className="split-count">
            {trackCount === 1 ? "1 track" : `${trackCount} tracks`}
          </span>
        </div>
        <div className="split-title">
          {fromStop ? "Options for: " + item.title : item.title || "Pick your track"}
        </div>
        <p className={"split-status" + (myLane ? "" : " split-status-todo")}>
          {myLane
            ? `YOU'RE ON TRACK ${myIndex + 1}. TAP ANOTHER TRACK TO SWITCH.`
            : "CHOOSE ONE TRACK BELOW."}
        </p>

        <div className="split-lanes">
          {item.groups.map((group, index) => {
            const summary = laneSummary(group);
            const isMine = group.id === myLane;
            const inLane = people.filter((person) => laneIdOf(item, person.userId) === group.id);
            return (
              <section
                className={
                  "split-lane split-lane-" + (index % 4) + (isMine ? " split-lane-mine" : "")
                }
                key={group.id}
                aria-label={"Track " + (index + 1)}
              >
                <div className="split-lane-head">
                  <span className="split-lane-name">TRACK {index + 1}</span>
                  <span className="split-lane-stats">
                    {summary.stopCount === 1 ? "1 stop" : `${summary.stopCount} stops`}
                    {summary.endsAt ? ` · done ${formatTime(summary.endsAt)}` : ""}
                  </span>
                </div>
                {group.kind === "original" && (
                  <div className="split-lane-badge split-lane-badge-original">THE ORIGINAL PLAN</div>
                )}
                {group.kind === "alt" && (
                  <div className="split-lane-badge">
                    {group.ownerId === me ? "YOUR SPLIT" : firstName(group.ownerName).toUpperCase() + "'S SPLIT"}
                  </div>
                )}
                {group.label && <div className="split-lane-label">{group.label}</div>}

                <button
                  className={"split-join" + (isMine ? " split-join-on" : "")}
                  aria-pressed={isMine}
                  disabled={isMine}
                  onClick={() => onPick(group.id)}
                >
                  {isMine ? "YOU'RE IN THIS TRACK" : myLane ? "SWITCH TO THIS TRACK" : "JOIN THIS TRACK"}
                </button>

                {group.kind === "alt" && group.ownerId === me && onRemoveMine && (
                  <button className="split-remove" onClick={() => onRemoveMine(group.id)}>
                    REMOVE MY SPLIT
                  </button>
                )}

                <div className="split-who">
                  {inLane.length === 0 && <span className="split-nobody">NO ONE YET</span>}
                  {inLane.map((person) => (
                    <span
                      className={"split-chip" + (person.userId === me ? " split-chip-me" : "")}
                      key={person.userId}
                    >
                      {person.userId === me ? "You" : firstName(person.name)}
                    </span>
                  ))}
                </div>
                <ol className="split-stops">
                  {group.items.map((stop) => (
                    <LaneStop item={stop} key={stop.id} />
                  ))}
                </ol>
              </section>
            );
          })}
        </div>

        {canSplitOff && (
          <button className="split-offer" onClick={() => onSplitOff(item.id)} disabled={splitting}>
            {splitting ? "FINDING AN IDEA..." : "+ SPLIT OFF WITH MY OWN IDEA"}
          </button>
        )}

        {undecided.length > 0 && (
          <div className="split-undecided">
            <span className="split-undecided-tag">NOT PICKED YET</span>
            <span className="split-undecided-names">
              {undecided
                .map((person) => (person.userId === me ? "You" : firstName(person.name)))
                .join(", ")}
            </span>
          </div>
        )}

        {regroup && (
          <div className="split-regroup">
            <span className="split-regroup-tag">REGROUP</span>
            <span className="split-regroup-text">
              <span className="split-regroup-when">{formatTime(regroup.time)}</span>
              {regroup.place && <span className="split-regroup-place">{regroup.place}</span>}
              {regroup.address && <span className="split-regroup-address">{regroup.address}</span>}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

export default SplitBlock;