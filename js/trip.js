// A trip's own page: who and when, flights, places to stay, the itinerary,
// and recommendations from the abroad guides.
import { db } from "./firebase.js?v=4";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { CALENDAR_START, CALENDAR_END } from "./config.js?v=4";
import { DatePicker, parseISO, addDays, daysBetween, md, shortDate } from "./datepicker.js?v=4";
import {
  $, el, swatch, mark, peopleText, ms, tripDates, toast, setupDialogs, armDelete,
  withBusy, PeoplePicker, segmented, ALL_IDS,
} from "./ui.js?v=4";
import { placesFor, CATEGORIES } from "./cities.js?v=4";

const tripId = new URLSearchParams(location.search).get("id");
const tripRef = tripId ? doc(db, "trips", tripId) : null;
const sub = (name) => collection(db, "trips", tripId, name);
const subDoc = (name, id) => doc(db, "trips", tripId, name, id);

let trip = null;      // the trip, with .dates and .people
let flights = [];
let stays = [];
let plans = [];
let ownRecs = [];     // recs your group added, for every city
let guideRecs = new Map(); // city slug -> items from the guides
let places = [];      // the trip's cities, matched from its destination

/* ---------- Small helpers ---------- */
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (n) => { n = ((n % 1440) + 1440) % 1440; return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; };
const isTime = (t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t);

// "9:30am", "9pm"
function fmtTime(t) {
  const [h, m] = t.split(":").map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
}

function hourLabel(h) {
  const hh = h % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? "am" : "pm"}`;
}

// Only allow ordinary web links.
function safeUrl(u) {
  u = (u || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(u)) return "https://" + u;
  return null;
}

function tripDays() {
  if (!trip) return [];
  const [a, d] = trip.dates;
  const n = Math.min(daysBetween(a, d), 20);
  return Array.from({ length: n + 1 }, (_, i) => addDays(a, i));
}

const alive = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.deleted);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (iso) => `${DOW[parseISO(iso).getUTCDay()]} ${md(iso)}`;

/* ---------- Header ---------- */
function renderHeader() {
  const [a, d] = trip.dates;
  const booked = trip.status === "booked";
  document.title = trip.destination || "Trip";
  $("#t-dates").textContent = a === d ? shortDate(a) : `${shortDate(a)} – ${shortDate(d)}`;
  const title = $("#t-dest");
  title.textContent = trip.destination || "Untitled trip";
  title.classList.toggle("is-planned", !booked);
  const names = peopleText(trip.people);
  $("#t-who").replaceChildren(
    el("span", { class: "swatches" }, ...trip.people.map(swatch)),
    el("span", {}, trip.guests ? `${names} with ${trip.guests}` : names));
  $("#t-status").className = `trip-status ${booked ? "is-booked" : "is-planned"}`;
  $("#t-status").replaceChildren(mark(), booked ? "Booked" : "Planned");
  $("#t-details").textContent = trip.details || "";
}

/* ---------- Flights ---------- */
const DIRS = [["there", "Getting there"], ["back", "Getting back"]];

function flightCard(f) {
  const times = isTime(f.dep)
    ? `${fmtTime(f.dep)}${isTime(f.arr) ? ` – ${fmtTime(f.arr)}${toMin(f.arr) < toMin(f.dep) ? " +1" : ""}` : ""}`
    : "";
  const route = f.from && f.to ? `${f.from} → ${f.to}` : f.from || f.to || f.number || "Flight";
  const people = ALL_IDS.filter((id) => (f.people || []).includes(id));
  return el("button", { type: "button", class: "item flight", dataset: { action: "edit-flight", id: f.id } },
    el("span", { class: "item-when" },
      el("span", { class: "strong" }, f.date ? shortDate(f.date) : "Date to come"),
      times ? el("span", {}, times) : null),
    el("span", { class: "item-main" },
      el("span", { class: "item-title" }, route),
      f.number && route !== f.number ? el("span", { class: "item-sub" }, f.number) : null,
      el("span", { class: "who" }, el("span", { class: "swatches" }, ...people.map(swatch)), el("span", {}, peopleText(people))),
      f.notes ? el("span", { class: "item-note" }, f.notes) : null));
}

function renderFlights() {
  const box = $("#flights");
  const sorted = flights.slice().sort((x, y) =>
    `${x.date || ""}${x.dep || ""}`.localeCompare(`${y.date || ""}${y.dep || ""}`) || ms(x.createdAt) - ms(y.createdAt));
  const parts = [];
  for (const [dir, label] of DIRS) {
    const list = sorted.filter((f) => (f.dir || "there") === dir);
    if (!list.length) continue;
    parts.push(el("div", { class: "group" }, el("h3", { class: "group-label" }, label), ...list.map(flightCard)));
  }
  box.replaceChildren(...(parts.length ? parts : [el("p", { class: "empty" }, "No flights added yet.")]));

  // Who still needs a flight each way.
  const gaps = [];
  if (flights.length) {
    for (const [dir] of DIRS) {
      const covered = new Set(flights.filter((f) => (f.dir || "there") === dir).flatMap((f) => f.people || []));
      const missing = trip.people.filter((id) => !covered.has(id));
      if (missing.length) gaps.push(el("p", {}, `No flight ${dir} yet: ${peopleText(missing)}`));
    }
  }
  $("#flight-gaps").replaceChildren(...gaps);
}

/* ---------- Places to stay ---------- */
function stayCard(s) {
  const people = ALL_IDS.filter((id) => (s.people || []).includes(id));
  const everyoneOnTrip = trip.people.every((id) => people.includes(id));
  const link = safeUrl(s.link);
  return el("div", { class: "item stay", dataset: { action: "edit-stay", id: s.id }, role: "button", tabindex: "0" },
    el("span", { class: "item-when" },
      s.checkIn ? el("span", {}, el("span", { class: "strong" }, "In "), shortDate(s.checkIn)) : null,
      s.checkOut ? el("span", {}, el("span", { class: "strong" }, "Out "), shortDate(s.checkOut)) : null),
    el("span", { class: "item-main" },
      el("span", { class: "item-title" }, s.name),
      s.address ? el("span", { class: "item-sub" }, s.address) : null,
      !everyoneOnTrip && people.length
        ? el("span", { class: "who" }, el("span", { class: "swatches" }, ...people.map(swatch)), el("span", {}, peopleText(people)))
        : null,
      s.notes ? el("span", { class: "item-note" }, s.notes) : null,
      link ? el("a", { class: "item-link", href: link, target: "_blank", rel: "noopener noreferrer" }, "Open link") : null));
}

function renderStays() {
  const sorted = stays.slice().sort((x, y) => (x.checkIn || "").localeCompare(y.checkIn || "") || ms(x.createdAt) - ms(y.createdAt));
  $("#stays").replaceChildren(...(sorted.length ? sorted.map(stayCard) : [el("p", { class: "empty" }, "No place to stay added yet.")]));
}

/* ---------- Itinerary planner ---------- */
const TYPES = [
  ["restaurant", "Restaurant"],
  ["daytrip", "Day trip"],
  ["tour", "Tour"],
  ["activity", "Activity"],
  ["nightlife", "Going out"],
  ["other", "Other"],
];
const TYPE_LABEL = new Map(TYPES);
const HOUR = 44; // pixels per hour

// Lay out overlapping plans side by side, the way a calendar does.
function layoutDay(items) {
  const evs = items
    .map((p) => {
      const s = toMin(p.start);
      let e = isTime(p.end) ? toMin(p.end) : s + 60;
      if (e <= s) e += 1440; // runs past midnight
      return { p, s, e: Math.max(e, s + 15) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let cols = [];
  let clusterEnd = -1;
  const finish = () => { for (const ev of cluster) ev.n = cols.length; cluster = []; cols = []; };
  for (const ev of evs) {
    if (ev.s >= clusterEnd && cluster.length) finish();
    let c = cols.findIndex((end) => end <= ev.s);
    if (c === -1) { c = cols.length; cols.push(ev.e); } else cols[c] = ev.e;
    ev.col = c;
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.e);
  }
  finish();
  return evs;
}

// Flights show on the itinerary by themselves, blocking off the time from
// takeoff to landing. Nobody adds them as plans; editing the flight moves it.
// Two people who logged the same flight separately show as one block.
function flightsOnDays(days) {
  const merged = new Map();
  const squash = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // "Vueling VY 7821", "vy7821" and "VY 7821" are the same flight.
  const code = (s) => {
    const m = (s || "").toUpperCase().match(/\b([A-Z]\d|\d[A-Z]|[A-Z]{2,3})\s*(\d{1,4})\b/);
    return m ? m[1] + m[2] : squash(s);
  };
  for (const f of flights) {
    if (!days.includes(f.date)) continue;
    const num = code(f.number);
    const key = num ? `${f.date}|${num}` : `${f.date}|${squash(f.from)}|${squash(f.to)}|${f.dep || ""}`;
    const hit = merged.get(key);
    if (!hit) { merged.set(key, { ...f, people: [...(f.people || [])] }); continue; }
    hit.people = [...new Set([...hit.people, ...(f.people || [])])];
    if (!isTime(hit.dep) && isTime(f.dep)) { hit.dep = f.dep; hit.arr = f.arr; }
  }
  return [...merged.values()].map((f) => ({
    flight: f,
    id: f.id,
    date: f.date,
    start: isTime(f.dep) ? f.dep : "",
    end: isTime(f.dep) && isTime(f.arr) ? f.arr : "",
  }));
}

function flightTitle(f) {
  if (f.to) return `Flight to ${f.to}`;
  if (f.from) return `Flight from ${f.from}`;
  return `Flight ${f.number || ""}`.trim();
}

// The flight number, plus who's on it when it isn't everyone on the trip.
function flightSub(f) {
  const people = ALL_IDS.filter((id) => f.people.includes(id));
  const everyone = trip.people.every((id) => people.includes(id));
  const num = f.to || f.from ? f.number : "";
  return [num, everyone ? "" : peopleText(people)].filter(Boolean).join(" · ");
}

function renderPlanner() {
  const days = tripDays();
  const flightItems = flightsOnDays(days);
  const timed = [
    ...plans.filter((p) => !p.allDay && isTime(p.start) && days.includes(p.date)),
    ...flightItems.filter((x) => x.start),
  ];
  const laid = new Map(days.map((d) => [d, layoutDay(timed.filter((p) => p.date === d))]));
  const all = [...laid.values()].flat();
  const startHour = Math.min(8, ...all.map((ev) => Math.floor(ev.s / 60)));
  const endHour = Math.min(30, Math.max(24, ...all.map((ev) => Math.ceil(ev.e / 60))));
  const hours = endHour - startHour;

  const grid = $("#planner");
  grid.style.setProperty("--days", days.length);
  grid.style.setProperty("--hour", `${HOUR}px`);
  const kids = [el("div", { class: "pl-corner" })];

  for (const d of days) {
    const dt = parseISO(d);
    kids.push(el("div", { class: "pl-dayhead" },
      el("span", { class: "pl-dow" }, DOW[dt.getUTCDay()]),
      el("span", { class: "pl-date" }, md(d))));
  }

  kids.push(el("div", { class: "pl-label" }, "All day"));
  for (const d of days) {
    const items = plans.filter((p) => p.allDay && p.date === d).sort((x, y) => ms(x.createdAt) - ms(y.createdAt));
    // A flight with no takeoff time yet still marks the day.
    const untimed = flightItems.filter((x) => !x.start && x.date === d);
    kids.push(el("div", { class: "pl-allday", dataset: { date: d }, title: "Add an all-day plan" },
      ...untimed.map(({ flight: f }) => el("button", { type: "button", class: "pl-event is-allday is-flight", dataset: { action: "edit-flight", id: f.id }, title: [flightSub(f), "Add the times to block them off"].filter(Boolean).join(". ") },
        el("span", { class: "pl-title" }, flightTitle(f)))),
      ...items.map((p) => el("button", { type: "button", class: "pl-event is-allday", dataset: { action: "edit-plan", id: p.id }, title: TYPE_LABEL.get(p.type) || "" },
        el("span", { class: "pl-title" }, p.title)))));
  }

  const times = el("div", { class: "pl-times", style: `height:${hours * HOUR}px` });
  for (let h = startHour + 1; h < endHour; h++) {
    times.append(el("span", { class: "pl-hour", style: `top:${(h - startHour) * HOUR}px` }, hourLabel(h)));
  }
  kids.push(times);

  for (const d of days) {
    const col = el("div", { class: "pl-col", dataset: { date: d, start: String(startHour) }, style: `height:${hours * HOUR}px` });
    for (const ev of laid.get(d)) {
      const p = ev.p;
      const top = ((ev.s - startHour * 60) / 60) * HOUR;
      const height = Math.max(((ev.e - ev.s) / 60) * HOUR - 2, 20);
      const width = 100 / ev.n;
      const size = height < 30 ? " is-tiny" : height < 64 ? " is-short" : "";
      const style = `top:${top}px;height:${height}px;left:calc(${ev.col * width}% + 2px);width:calc(${width}% - 4px)`;
      if (p.flight) {
        const f = p.flight;
        const sub = flightSub(f);
        const nextDay = isTime(f.arr) && toMin(f.arr) < toMin(f.dep) ? " +1" : "";
        col.append(el("button", {
          type: "button",
          class: `pl-event is-flight${size}`,
          dataset: { action: "edit-flight", id: f.id },
          title: [flightTitle(f), sub].filter(Boolean).join(", "),
          style,
        },
          el("span", { class: "pl-time" }, `${fmtTime(p.start)}${p.end ? ` – ${fmtTime(p.end)}${nextDay}` : ""}`),
          el("span", { class: "pl-title" }, flightTitle(f)),
          sub && height >= 60 ? el("span", { class: "pl-place" }, sub) : null));
        continue;
      }
      col.append(el("button", {
        type: "button",
        class: `pl-event${size}`,
        dataset: { action: "edit-plan", id: p.id },
        title: [TYPE_LABEL.get(p.type), p.place].filter(Boolean).join(", "),
        style,
      },
        el("span", { class: "pl-time" }, `${fmtTime(p.start)}${isTime(p.end) ? ` – ${fmtTime(p.end)}` : ""}`),
        el("span", { class: "pl-title" }, p.title),
        p.place && height >= 60 ? el("span", { class: "pl-place" }, p.place) : null));
    }
    kids.push(col);
  }
  grid.replaceChildren(...kids);
}

$("#planner").addEventListener("click", (e) => {
  if (e.target.closest("[data-action=edit-flight]")) return; // opens the flight (handled below)
  const ev = e.target.closest("[data-action=edit-plan]");
  if (ev) { const p = plans.find((x) => x.id === ev.dataset.id); if (p) openPlan({ plan: p }); return; }
  const allday = e.target.closest(".pl-allday");
  if (allday) { openPlan({ date: allday.dataset.date, allDay: true }); return; }
  const col = e.target.closest(".pl-col");
  if (col) {
    const y = e.clientY - col.getBoundingClientRect().top;
    const mins = Number(col.dataset.start) * 60 + Math.floor((y / HOUR) * 2) * 30;
    openPlan({ date: col.dataset.date, start: fromMin(mins) });
  }
});

/* ---------- Recommendations ---------- */
const CAT_LABEL = new Map(CATEGORIES);
const CAT_TO_TYPE = { eat: "restaurant", drink: "nightlife", do: "activity", stay: "other", tips: "other" };
const SHOW = 6; // items shown per category before "Show all"
const expanded = new Set();

const normName = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

async function loadGuideRecs() {
  places = placesFor(trip.destination || "");
  await Promise.all(places.filter((p) => p.known && !guideRecs.has(p.slug)).map(async (p) => {
    try {
      const snap = await getDoc(doc(db, "guideRecs", p.slug));
      guideRecs.set(p.slug, snap.exists() ? snap.data().items || [] : []);
    } catch (err) {
      console.error(err);
      guideRecs.set(p.slug, []);
    }
  }));
  renderRecs();
}

function recsFor(slug) {
  const merged = new Map();
  for (const r of guideRecs.get(slug) || []) merged.set(`${r.cat}|${normName(r.name)}`, { ...r, n: r.n || 1 });
  for (const r of ownRecs.filter((x) => x.city === slug)) {
    const key = `${r.cat}|${normName(r.name)}`;
    const hit = merged.get(key);
    if (hit) { hit.n += 1; hit.ownId = r.id; if (!hit.note && r.note) hit.note = r.note; }
    else merged.set(key, { name: r.name, note: r.note, cat: r.cat, n: 1, ownId: r.id, own: true });
  }
  return [...merged.values()];
}

function recItem(r, place) {
  return el("li", { class: "rec" },
    el("div", { class: "rec-top" },
      r.own
        ? el("button", { type: "button", class: "rec-name is-own", dataset: { action: "edit-rec", id: r.ownId }, title: "Your group's rec. Tap to edit." }, r.name)
        : el("span", { class: "rec-name" }, r.name),
      r.n > 1 ? el("span", { class: "tally", title: `Recommended in ${r.n} guides` }, String(r.n)) : null),
    r.note ? el("p", { class: "rec-note" }, r.note) : null,
    r.cat !== "tips" && r.cat !== "stay"
      ? el("button", { type: "button", class: "link", dataset: { action: "rec-to-day", city: place.slug, name: r.name, cat: r.cat, note: r.note || "" } }, "Add to day")
      : null);
}

function renderRecs() {
  const box = $("#recs");
  if (!places.length) { box.replaceChildren(el("p", { class: "empty" }, "Add a destination to see recommendations.")); return; }
  box.replaceChildren(...places.map((place) => {
    const items = recsFor(place.slug);
    const head = el("div", { class: "rec-city-head" },
      el("h3", { class: "rec-city" }, place.name, place.nearby ? el("span", { class: "rec-near" }, "Day trip") : null),
      el("button", { type: "button", class: "link", dataset: { action: "add-rec", city: place.slug, cityName: place.name } }, "Add a rec"));
    if (!items.length) {
      return el("div", { class: "rec-city-block" }, head, el("p", { class: "empty" }, `No guide recs for ${place.name} yet. Add your own and they'll show on any trip there.`));
    }
    const cats = CATEGORIES.map(([cat, label]) => {
      const list = items.filter((r) => r.cat === cat).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));
      if (!list.length) return null;
      const key = `${place.slug}|${cat}`;
      const open = expanded.has(key);
      const shown = open ? list : list.slice(0, SHOW);
      return el("div", { class: "rec-cat" },
        el("h4", { class: "rec-cat-label" }, label),
        el("ul", { class: "rec-list" }, ...shown.map((r) => recItem(r, place))),
        list.length > SHOW
          ? el("button", { type: "button", class: "link more", dataset: { action: "toggle-cat", key } }, open ? "Show fewer" : `Show all ${list.length}`)
          : null);
    });
    return el("div", { class: "rec-city-block" }, head, ...cats);
  }));
}

$("#recs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action } = b.dataset;
  if (action === "toggle-cat") {
    const { key } = b.dataset;
    expanded.has(key) ? expanded.delete(key) : expanded.add(key);
    renderRecs();
  } else if (action === "rec-to-day") {
    const type = CAT_TO_TYPE[b.dataset.cat] || "other";
    const start = type === "restaurant" ? "20:30" : type === "nightlife" ? "23:00" : "11:00";
    openPlan({ title: b.dataset.name, type, notes: b.dataset.note, start, fromRec: true });
  } else if (action === "add-rec") {
    openRec({ city: b.dataset.city, cityName: b.dataset.cityName });
  } else if (action === "edit-rec") {
    const r = ownRecs.find((x) => x.id === b.dataset.id);
    if (r) openRec({ rec: r });
  }
});

/* ---------- Clicks on flights and stays ---------- */
document.addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const b = e.target.closest("[data-action=edit-flight], [data-action=edit-stay]");
  if (!b) return;
  if (b.dataset.action === "edit-flight") { const f = flights.find((x) => x.id === b.dataset.id); if (f) openFlight({ flight: f }); }
  else { const s = stays.find((x) => x.id === b.dataset.id); if (s) openStay({ stay: s }); }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".stay[role=button]")) { e.preventDefault(); e.target.click(); }
});

setupDialogs();

/* ---------- Flight dialog ---------- */
const flightDlg = $("#flight-dialog");
const flightForm = $("#flight-form");
const flightErr = $("#flight-error");
const flWho = new PeoplePicker($("#fl-people"), { allLabel: "Everyone on the trip" });
const flDate = new DatePicker($("#fl-date"), { min: CALENDAR_START, max: CALENDAR_END });
let editingFlight = null;
let flDateTouched = false;

const missingFor = (dir, except) => {
  const covered = new Set(flights.filter((f) => (f.dir || "there") === dir && f !== except).flatMap((f) => f.people || []));
  return trip.people.filter((id) => !covered.has(id));
};

const flDir = segmented($("#fl-dir"), DIRS.map(([v]) => [v, v === "there" ? "There" : "Back"]), (dir) => {
  if (editingFlight) return;
  if (!flDateTouched) flDate.set(dir === "there" ? trip.dates[0] : trip.dates[1]);
  flWho.set(missingFor(dir));
});
flDate.onChange = () => { flDateTouched = true; };

function openFlight({ flight } = {}) {
  editingFlight = flight || null;
  flDateTouched = false;
  $("#flight-title").textContent = flight ? "Edit flight" : "Add flight";
  $("#flight-save").textContent = flight ? "Save changes" : "Add flight";
  flightErr.textContent = "";
  flWho.setOptions(ALL_IDS.filter((id) => trip.people.includes(id) || (flight?.people || []).includes(id)));
  const dir = flight?.dir || "there";
  flDir.value = dir;
  flWho.set(flight ? flight.people || [] : missingFor(dir));
  $("#fl-number").value = flight?.number || "";
  $("#fl-from").value = flight?.from || "";
  $("#fl-to").value = flight?.to || "";
  flDate.set(flight?.date || trip.dates[0]);
  $("#fl-dep").value = flight?.dep || "";
  $("#fl-arr").value = flight?.arr || "";
  $("#fl-notes").value = flight?.notes || "";
  const del = $("#flight-delete");
  del.hidden = !flight;
  if (flight) armDelete(del, "Delete flight", () => softDelete("flights", flight.id, flightDlg, flightErr, "Flight deleted"));
  flightDlg.showModal();
  if (!flight) $("#fl-number").focus();
}

flightForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    dir: flDir.value,
    people: flWho.value,
    number: $("#fl-number").value.trim(),
    from: $("#fl-from").value.trim(),
    to: $("#fl-to").value.trim(),
    date: flDate.value,
    dep: $("#fl-dep").value,
    arr: $("#fl-arr").value,
    notes: $("#fl-notes").value.trim(),
  };
  if (!data.people.length) { flightErr.textContent = "Pick who's on this flight."; return; }
  if (!data.number && !(data.from && data.to)) { flightErr.textContent = "Add the flight number, or where it flies from and to."; $("#fl-number").focus(); return; }
  await saveSub("flights", editingFlight, data, flightForm, flightErr, flightDlg, editingFlight ? "Changes saved" : "Flight added");
});

/* ---------- Stay dialog ---------- */
const stayDlg = $("#stay-dialog");
const stayForm = $("#stay-form");
const stayErr = $("#stay-error");
const stWho = new PeoplePicker($("#st-people"), { allLabel: "Everyone on the trip" });
const stIn = new DatePicker($("#st-in"), {
  min: CALENDAR_START,
  max: CALENDAR_END,
  onChange: (a) => { if (stOut.value < a) stOut.set(a); stOut.floor = a; stOut.rangeStart = a; },
});
const stOut = new DatePicker($("#st-out"), { min: CALENDAR_START, max: CALENDAR_END });
let editingStay = null;

function openStay({ stay } = {}) {
  editingStay = stay || null;
  $("#stay-title").textContent = stay ? "Edit place to stay" : "Add place to stay";
  $("#stay-save").textContent = stay ? "Save changes" : "Add place";
  stayErr.textContent = "";
  $("#st-name").value = stay?.name || "";
  $("#st-address").value = stay?.address || "";
  $("#st-link").value = stay?.link || "";
  $("#st-notes").value = stay?.notes || "";
  stIn.set(stay?.checkIn || trip.dates[0]);
  stOut.set(stay?.checkOut || trip.dates[1]);
  stOut.floor = stIn.value;
  stOut.rangeStart = stIn.value;
  stWho.setOptions(ALL_IDS.filter((id) => trip.people.includes(id) || (stay?.people || []).includes(id)));
  stWho.set(stay ? stay.people || [] : trip.people);
  const del = $("#stay-delete");
  del.hidden = !stay;
  if (stay) armDelete(del, "Delete place", () => softDelete("stays", stay.id, stayDlg, stayErr, "Place deleted"));
  stayDlg.showModal();
  if (!stay) $("#st-name").focus();
}

stayForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const link = safeUrl($("#st-link").value);
  const data = {
    name: $("#st-name").value.trim(),
    address: $("#st-address").value.trim(),
    checkIn: stIn.value,
    checkOut: stOut.value < stIn.value ? stIn.value : stOut.value,
    people: stWho.value,
    link: link || "",
    notes: $("#st-notes").value.trim(),
  };
  if (!data.name) { stayErr.textContent = "Add the name of the place."; $("#st-name").focus(); return; }
  if (link === null) { stayErr.textContent = "That link doesn't look like a web address."; $("#st-link").focus(); return; }
  await saveSub("stays", editingStay, data, stayForm, stayErr, stayDlg, editingStay ? "Changes saved" : "Place added");
});

/* ---------- Plan dialog ---------- */
const planDlg = $("#plan-dialog");
const planForm = $("#plan-form");
const planErr = $("#plan-error");
let editingPlan = null;

// Single-choice chips.
function choice(container) {
  let value = null;
  container.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    value = b.dataset.pick;
    sync();
  });
  const sync = () => { for (const b of container.querySelectorAll("[data-pick]")) b.setAttribute("aria-pressed", String(b.dataset.pick === value)); };
  return {
    setOptions(opts) {
      container.replaceChildren(...opts.map(([v, label]) => el("button", { type: "button", class: "pick-chip", dataset: { pick: v }, "aria-pressed": "false" }, label)));
      sync();
    },
    get value() { return value; },
    set value(v) { value = v; sync(); },
  };
}

const plType = choice($("#pl-type"));
plType.setOptions(TYPES);
const plDay = choice($("#pl-day"));

$("#pl-allday").addEventListener("change", () => { $("#pl-times").hidden = $("#pl-allday").checked; });

function openPlan({ plan, date, start, allDay, title, type, notes, fromRec } = {}) {
  editingPlan = plan || null;
  $("#plan-title").textContent = plan ? "Edit plan" : "Add plan";
  $("#plan-save").textContent = plan ? "Save changes" : "Add plan";
  planErr.textContent = "";
  const days = tripDays();
  plDay.setOptions(days.map((d) => [d, dayLabel(d)]));
  plDay.value = plan?.date || date || days[0];
  plType.value = plan?.type || type || "activity";
  $("#pl-title").value = plan?.title || title || "";
  const isAllDay = plan ? !!plan.allDay : !!allDay || type === "daytrip";
  $("#pl-allday").checked = isAllDay;
  $("#pl-times").hidden = isAllDay;
  const s = plan?.start || start || "10:00";
  $("#pl-start").value = s;
  $("#pl-end").value = plan ? plan.end || "" : fromMin(toMin(s) + (type === "restaurant" ? 90 : 60));
  $("#pl-place").value = plan?.place || "";
  $("#pl-link").value = plan?.link || "";
  $("#pl-notes").value = plan?.notes || notes || "";
  const del = $("#plan-delete");
  del.hidden = !plan;
  if (plan) armDelete(del, "Delete plan", () => softDelete("plans", plan.id, planDlg, planErr, "Plan deleted"));
  planDlg.showModal();
  if (!plan && !fromRec) $("#pl-title").focus();
}

planForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const link = safeUrl($("#pl-link").value);
  const allDay = $("#pl-allday").checked;
  const data = {
    title: $("#pl-title").value.trim(),
    type: plType.value || "other",
    date: plDay.value,
    allDay,
    start: allDay ? "" : $("#pl-start").value,
    end: allDay ? "" : $("#pl-end").value,
    place: $("#pl-place").value.trim(),
    link: link || "",
    notes: $("#pl-notes").value.trim(),
  };
  if (!data.title) { planErr.textContent = "Add what the plan is."; $("#pl-title").focus(); return; }
  if (!data.date) { planErr.textContent = "Pick a day."; return; }
  if (!allDay && !isTime(data.start)) { planErr.textContent = "Add a start time, or make it all day."; $("#pl-start").focus(); return; }
  if (link === null) { planErr.textContent = "That link doesn't look like a web address."; $("#pl-link").focus(); return; }
  await saveSub("plans", editingPlan, data, planForm, planErr, planDlg, editingPlan ? "Changes saved" : "Plan added");
});

/* ---------- Your own recs ---------- */
const recDlg = $("#rec-dialog");
const recForm = $("#rec-form");
const recErr = $("#rec-error");
const rcCat = choice($("#rc-cat"));
rcCat.setOptions(CATEGORIES);
let editingRec = null;
let recCity = null;

function openRec({ rec, city, cityName } = {}) {
  editingRec = rec || null;
  recCity = rec?.city || city;
  $("#rec-title").textContent = rec ? "Edit rec" : "Add a rec";
  $("#rec-save").textContent = rec ? "Save changes" : "Add rec";
  $("#rec-city").textContent = rec?.cityName || cityName || "";
  recErr.textContent = "";
  $("#rc-name").value = rec?.name || "";
  $("#rc-note").value = rec?.note || "";
  rcCat.value = rec?.cat || "eat";
  const del = $("#rec-delete");
  del.hidden = !rec;
  if (rec) {
    armDelete(del, "Delete rec", async () => {
      const ref = doc(db, "recs", rec.id);
      try {
        await updateDoc(ref, { deleted: true, updatedAt: serverTimestamp() });
        recDlg.close();
        toast("Rec deleted", () => updateDoc(ref, { deleted: false, updatedAt: serverTimestamp() }));
      } catch (err) { console.error(err); recErr.textContent = "Couldn't delete. Check your connection and try again."; }
    });
  }
  recDlg.showModal();
  $("#rc-name").focus();
}

recForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = { name: $("#rc-name").value.trim(), note: $("#rc-note").value.trim(), cat: rcCat.value || "eat" };
  if (!data.name) { recErr.textContent = "Add the name of the place or thing."; $("#rc-name").focus(); return; }
  const cityName = places.find((p) => p.slug === recCity)?.name || editingRec?.cityName || "";
  const wasEditing = !!editingRec;
  const ok = await withBusy(recForm, recErr, async () => {
    if (editingRec) await updateDoc(doc(db, "recs", editingRec.id), { ...data, updatedAt: serverTimestamp() });
    else await addDoc(collection(db, "recs"), { ...data, city: recCity, cityName, deleted: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
  if (ok) { recDlg.close(); toast(wasEditing ? "Changes saved" : "Rec added"); }
});

/* ---------- Saving ---------- */
async function saveSub(name, editing, data, form, errEl, dlg, message) {
  const ok = await withBusy(form, errEl, async () => {
    if (editing) await updateDoc(subDoc(name, editing.id), { ...data, updatedAt: serverTimestamp() });
    else await addDoc(sub(name), { ...data, deleted: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
  if (ok) { dlg.close(); toast(message); }
}

async function softDelete(name, id, dlg, errEl, message) {
  const ref = subDoc(name, id);
  try {
    await updateDoc(ref, { deleted: true, updatedAt: serverTimestamp() });
    dlg.close();
    toast(message, () => updateDoc(ref, { deleted: false, updatedAt: serverTimestamp() }));
  } catch (err) {
    console.error(err);
    errEl.textContent = "Couldn't delete. Check your connection and try again.";
  }
}

$("#add-flight").addEventListener("click", () => openFlight());
$("#add-stay").addEventListener("click", () => openStay());
$("#add-plan").addEventListener("click", () => openPlan());

/* ---------- Live data ---------- */
function showMessage(text) {
  const msg = $("#status-msg");
  msg.hidden = false;
  msg.replaceChildren(text, " ", el("a", { href: "./" }, "Back to all weekends"));
  $("#trip-body").hidden = true;
}

function onLoadError(err) {
  console.error(err);
  showMessage("This trip couldn't load. Check your connection and refresh the page.");
}

let lastDestination = null;

if (!tripRef) {
  showMessage("No trip was picked.");
} else {
  onSnapshot(tripRef, (snap) => {
    const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    const dates = data && !data.deleted ? tripDates(data) : null;
    if (!dates) { trip = null; showMessage("This trip was deleted or doesn't exist."); return; }
    trip = { ...data, dates, people: ALL_IDS.filter((id) => (data.people || []).includes(id)) };
    $("#status-msg").hidden = true;
    $("#trip-body").hidden = false;
    renderHeader();
    renderFlights();
    renderStays();
    renderPlanner();
    if (trip.destination !== lastDestination) { lastDestination = trip.destination; loadGuideRecs(); }
  }, onLoadError);

  onSnapshot(sub("flights"), (snap) => { flights = alive(snap); if (trip) { renderFlights(); renderPlanner(); } }, onLoadError);
  onSnapshot(sub("stays"), (snap) => { stays = alive(snap); if (trip) renderStays(); }, onLoadError);
  onSnapshot(sub("plans"), (snap) => { plans = alive(snap); if (trip) renderPlanner(); }, onLoadError);
  onSnapshot(collection(db, "recs"), (snap) => { ownRecs = alive(snap); if (trip) renderRecs(); }, onLoadError);
}
