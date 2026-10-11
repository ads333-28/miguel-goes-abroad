// Home page: the weekend-by-weekend timeline.
import { db } from "./firebase.js?v=2";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { PEOPLE, SEASON_START, SEASON_END, BREAKS, CALENDAR_START, CALENDAR_END } from "./config.js?v=2";
import { DatePicker, parseISO, addDays, daysBetween, md } from "./datepicker.js?v=2";

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const PERSON = new Map(PEOPLE.map((p) => [p.id, p]));
const ALL_IDS = PEOPLE.map((p) => p.id);

// Build an element. Text is always set as text, never as HTML.
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
  return n;
}

function swatch(id) {
  const s = el("span", { class: "swatch", "aria-hidden": "true" });
  s.style.setProperty("--c", `var(--p-${id})`);
  return s;
}

// Octagon status mark: filled when booked, outlined when planned.
function mark() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("class", "mark");
  svg.setAttribute("aria-hidden", "true");
  const poly = document.createElementNS(ns, "polygon");
  poly.setAttribute("points", "3,0.5 7,0.5 9.5,3 9.5,7 7,9.5 3,9.5 0.5,7 0.5,3");
  svg.append(poly);
  return svg;
}

function listText(names) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

const ms = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : Number.MAX_SAFE_INTEGER);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/* ---------- Rows: Thursday–Sunday weekends, plus longer breaks ---------- */
const ROWS = [];
for (let thu = SEASON_START; thu <= SEASON_END; thu = addDays(thu, 7)) {
  const sun = addDays(thu, 3);
  if (BREAKS.some((b) => thu <= b.end && sun >= b.start)) continue; // covered by a break
  ROWS.push({ id: thu, start: thu, end: sun, label: null });
}
for (const b of BREAKS) ROWS.push({ id: b.start, start: b.start, end: b.end, label: b.label });
ROWS.sort((a, b) => (a.start < b.start ? -1 : 1));
const ROW = new Map(ROWS.map((r) => [r.id, r]));

function rangeLabel(r) {
  const a = parseISO(r.start), b = parseISO(r.end);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${MON[a.getUTCMonth()]} ${a.getUTCDate()}–${b.getUTCDate()}`
    : `${MON[a.getUTCMonth()]} ${a.getUTCDate()}–${MON[b.getUTCMonth()]} ${b.getUTCDate()}`;
}

// Which row a date range belongs on: the row it overlaps most.
// Dates between rows go to the nearest one (a Monday joins the weekend
// before it; a Tuesday or Wednesday joins the weekend after).
function rowFor(a, d) {
  let best = null;
  let bestDays = 0;
  for (const r of ROWS) {
    const s = a > r.start ? a : r.start;
    const e = d < r.end ? d : r.end;
    if (s <= e) {
      const days = daysBetween(s, e) + 1;
      if (days > bestDays) { best = r; bestDays = days; }
    }
  }
  if (best) return best;
  let pick = null;
  let dist = Infinity;
  for (const r of ROWS) {
    const gap = r.start > d ? daysBetween(d, r.start) : daysBetween(r.end, a);
    if (gap < dist || (gap === dist && r.start > d)) { pick = r; dist = gap; }
  }
  return pick;
}

function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

// Mark the row happening now (or the next one, once the semester has started).
const TODAY = todayISO();
let CURRENT = null;
let CURRENT_TAG = "";
{
  const now = ROWS.find((r) => r.start <= TODAY && TODAY <= r.end);
  if (now) { CURRENT = now.id; CURRENT_TAG = now.label ? "Happening now" : "This weekend"; }
  else if (TODAY > ROWS[0].start) {
    const next = ROWS.find((r) => r.start > TODAY);
    if (next) { CURRENT = next.id; CURRENT_TAG = "Up next"; }
  }
}

/* ---------- Reading saved trips and notes ---------- */
// Older entries were saved with only a weekend; read those as Thursday–Sunday.
function tripDates(t) {
  const a = isDate(t.arrive) ? t.arrive : isDate(t.weekend) ? t.weekend : null;
  if (!a) return null;
  let d = isDate(t.depart) ? t.depart : isDate(t.weekend) ? addDays(t.weekend, 3) : a;
  if (d < a) d = a;
  return [a, d];
}

function noteDate(n) {
  return isDate(n.date) ? n.date : isDate(n.weekend) ? n.weekend : null;
}

/* ---------- State ---------- */
let trips = [];
let notes = [];
let tripsReady = false;
let notesReady = false;
let scrolled = false;
let filter = store.get("mga-filter");
if (!PERSON.has(filter)) filter = "all";

/* ---------- Person filter ---------- */
function buildFilter() {
  const chip = (id, label) =>
    el("button", { type: "button", class: "chip", "aria-pressed": String(filter === id), dataset: { filter: id } },
      id === "all" ? null : swatch(id), label);
  $("#filter").replaceChildren(chip("all", "All"), ...PEOPLE.map((p) => chip(p.id, p.name)));
}

$("#filter").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  filter = filter === b.dataset.filter && filter !== "all" ? "all" : b.dataset.filter;
  store.set("mga-filter", filter);
  for (const c of $("#filter").querySelectorAll("[data-filter]")) c.setAttribute("aria-pressed", String(c.dataset.filter === filter));
  renderAll();
});

/* ---------- Timeline ---------- */
function buildTimeline() {
  const root = $("#timeline");
  root.replaceChildren();
  let month = -1;
  let section;
  for (const r of ROWS) {
    const m = parseISO(r.start).getUTCMonth();
    if (m !== month) {
      month = m;
      section = el("section", { class: "month", "aria-labelledby": `m-${m}` }, el("h2", { id: `m-${m}` }, MONTH[m]));
      root.append(section);
    }
    const isCurrent = r.id === CURRENT;
    section.append(
      el("article", { class: "weekend", id: `r-${r.id}`, "aria-label": r.label ? `${r.label}, ${rangeLabel(r)}` : `Weekend of ${rangeLabel(r)}` },
        el("div", { class: "when" },
          el("div", { class: "when-top" },
            el("span", { class: "range" }, rangeLabel(r)),
            isCurrent ? el("span", { class: "tag" }, CURRENT_TAG) : null),
          r.label ? el("span", { class: "period" }, r.label) : null,
          el("div", { class: "notes" })),
        el("div", { class: "body" },
          el("div", { class: "trips" }),
          el("div", { class: "actions" },
            el("button", { type: "button", class: "link", dataset: { action: "add-trip", row: r.id } }, "Add trip"),
            el("button", { type: "button", class: "link", dataset: { action: "add-note", row: r.id } }, "Add note"))))
    );
  }
}

function tripRow(t) {
  const people = ALL_IDS.filter((id) => (t.people || []).includes(id));
  const everyone = ALL_IDS.every((id) => people.includes(id));
  const booked = t.status === "booked";
  const dim = filter !== "all" && !people.includes(filter);
  const names = everyone ? "Everyone" : listText(people.map((id) => PERSON.get(id).name));
  const [a, d] = t.dates;

  return el("button",
    {
      type: "button",
      class: `trip ${booked ? "is-booked" : "is-planned"}${dim ? " is-dim" : ""}`,
      dataset: { action: "edit-trip", id: t.id },
    },
    el("span", { class: "dest" }, t.destination || "Untitled trip"),
    el("span", { class: "status" }, mark(), booked ? "Booked" : "Planned"),
    el("span", { class: "who" },
      el("span", { class: "swatches" }, ...people.map(swatch)),
      el("span", {}, t.guests ? `${names} with ${t.guests}` : names)),
    el("span", { class: "meta" },
      el("span", {}, a === d ? md(a) : `${md(a)} – ${md(d)}`),
      t.details ? el("span", {}, t.details) : null)
  );
}

function renderAll() {
  if (!tripsReady || !notesReady) return;
  const tripsByRow = new Map(ROWS.map((r) => [r.id, []]));
  for (const t of trips) tripsByRow.get(rowFor(...t.dates).id).push(t);
  const notesByRow = new Map(ROWS.map((r) => [r.id, []]));
  for (const n of notes) notesByRow.get(rowFor(n.date, n.date).id).push(n);

  for (const r of ROWS) {
    const row = document.getElementById(`r-${r.id}`);
    const rowTrips = tripsByRow.get(r.id).sort((x, y) =>
      x.dates[0] < y.dates[0] ? -1 : x.dates[0] > y.dates[0] ? 1 : ms(x.createdAt) - ms(y.createdAt));
    const rowNotes = notesByRow.get(r.id).sort((x, y) =>
      x.date < y.date ? -1 : x.date > y.date ? 1 : ms(x.createdAt) - ms(y.createdAt));

    $(".notes", row).replaceChildren(...rowNotes.map((n) =>
      el("button", { type: "button", class: "note", dataset: { action: "edit-note", id: n.id } }, `${n.text}, ${md(n.date)}`)));
    $(".trips", row).replaceChildren(...rowTrips.map(tripRow));
  }
}

$("#timeline").addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action, row, id } = b.dataset;
  if (action === "add-trip") openTrip({ row: ROW.get(row) });
  else if (action === "edit-trip") { const t = trips.find((x) => x.id === id); if (t) openTrip({ trip: t }); }
  else if (action === "add-note") openNote({ row: ROW.get(row) });
  else if (action === "edit-note") { const n = notes.find((x) => x.id === id); if (n) openNote({ note: n }); }
});

/* ---------- Live data ---------- */
function onData() {
  if (!tripsReady || !notesReady) return;
  $("#status-msg").hidden = true;
  renderAll();
  if (!scrolled) {
    scrolled = true;
    if (CURRENT) document.getElementById(`r-${CURRENT}`)?.scrollIntoView({ block: "start" });
  }
}

function onLoadError(err) {
  console.error(err);
  const msg = $("#status-msg");
  msg.hidden = false;
  msg.textContent = "Plans couldn't load. Check your connection and refresh the page.";
}

onSnapshot(collection(db, "trips"), (snap) => {
  trips = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => !t.deleted)
    .map((t) => ({ ...t, dates: tripDates(t) }))
    .filter((t) => t.dates);
  tripsReady = true;
  onData();
}, onLoadError);

onSnapshot(collection(db, "notes"), (snap) => {
  notes = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((n) => !n.deleted)
    .map((n) => ({ ...n, date: noteDate(n) }))
    .filter((n) => n.date && n.text);
  notesReady = true;
  onData();
}, onLoadError);

/* ---------- Toast ---------- */
let toastTimer;
function toast(text, undo) {
  const t = $("#toast");
  const u = $("#toast-undo");
  $("#toast-text").textContent = text;
  u.hidden = !undo;
  u.onclick = undo
    ? async () => {
        t.hidden = true;
        try { await undo(); } catch (err) { console.error(err); toast("Couldn't undo. Check your connection and try again."); }
      }
    : null;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 7000 : 2800);
}

/* ---------- Dialog basics ---------- */
for (const dlg of document.querySelectorAll("dialog")) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });
  // Escape closes an open calendar first, then the dialog.
  dlg.addEventListener("cancel", (e) => {
    const cal = dlg.querySelector(".cal:not([hidden])");
    if (cal) { e.preventDefault(); cal.picker.close(); }
  });
  dlg.addEventListener("close", () => {
    for (const cal of dlg.querySelectorAll(".cal")) cal.picker.close();
  });
}

// Clear a form's error as soon as someone changes something.
for (const [form, err] of [["#trip-form", "#trip-error"], ["#note-form", "#note-error"]]) {
  $(form).addEventListener("input", () => { $(err).textContent = ""; });
  $(form).addEventListener("click", (e) => { if (e.target.closest("[data-pick], .cal-day")) $(err).textContent = ""; });
}

function armDelete(btn, label, onConfirm) {
  let timer;
  const reset = () => { clearTimeout(timer); delete btn.dataset.armed; btn.textContent = label; };
  btn.onclick = () => {
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.textContent = "Confirm delete";
      timer = setTimeout(reset, 4000);
      return;
    }
    reset();
    onConfirm();
  };
  reset();
}

/* ---------- Trip dialog ---------- */
const tripDlg = $("#trip-dialog");
const tripForm = $("#trip-form");
let editingTrip = null;
let picked = new Set();

const arrivePicker = new DatePicker($("#f-arrive"), {
  min: CALENDAR_START,
  max: CALENDAR_END,
  onChange: (a) => {
    if (departPicker.value < a) departPicker.set(a);
    syncDepart();
  },
});
const departPicker = new DatePicker($("#f-depart"), { min: CALENDAR_START, max: CALENDAR_END });

function syncDepart() {
  departPicker.floor = arrivePicker.value;
  departPicker.rangeStart = arrivePicker.value;
}

$("#f-people").replaceChildren(
  el("button", { type: "button", class: "pick-chip", dataset: { pick: "all" }, "aria-pressed": "false" }, "Everyone"),
  ...PEOPLE.map((p) => el("button", { type: "button", class: "pick-chip", dataset: { pick: p.id }, "aria-pressed": "false" }, swatch(p.id), p.name))
);

function syncPicker() {
  for (const b of $("#f-people").querySelectorAll("[data-pick]")) {
    const id = b.dataset.pick;
    const on = id === "all" ? ALL_IDS.every((x) => picked.has(x)) : picked.has(id);
    b.setAttribute("aria-pressed", String(on));
  }
}

$("#f-people").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pick]");
  if (!b) return;
  const id = b.dataset.pick;
  if (id === "all") picked = ALL_IDS.every((x) => picked.has(x)) ? new Set() : new Set(ALL_IDS);
  else if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  syncPicker();
});

function tripError(text, focusSel) {
  $("#trip-error").textContent = text;
  if (focusSel) $(focusSel).focus();
}

function openTrip({ row, trip }) {
  editingTrip = trip || null;
  $("#trip-title").textContent = trip ? "Edit trip" : "Add trip";
  $("#trip-save").textContent = trip ? "Save changes" : "Add trip";
  $("#trip-error").textContent = "";

  $("#f-dest").value = trip?.destination || "";
  $("#f-guests").value = trip?.guests || "";
  $("#f-details").value = trip?.details || "";
  picked = new Set(trip ? trip.people || [] : filter !== "all" ? [filter] : []);
  syncPicker();

  const [a, d] = trip ? trip.dates : [row.start, row.end];
  arrivePicker.set(a);
  departPicker.set(d);
  syncDepart();

  // New trips choose a status; existing trips get a one-tap button to move it along.
  $("#f-status-field").hidden = !!trip;
  if (!trip) tripForm.elements.status.value = "planned";

  const statusRow = $("#trip-status-row");
  statusRow.hidden = !trip;
  if (trip) {
    const booked = trip.status === "booked";
    const now = $("#trip-status-now");
    now.className = `status-now ${booked ? "is-booked" : "is-planned"}`;
    now.replaceChildren(mark(), booked ? "Booked" : "Planned");
    const toggle = $("#trip-status-toggle");
    toggle.textContent = booked ? "Move back to planned" : "Mark as booked";
    toggle.className = booked ? "link" : "primary small";
  }

  const del = $("#trip-delete");
  del.hidden = !trip;
  if (trip) armDelete(del, "Delete trip", deleteTrip);

  tripDlg.showModal();
  if (!trip) $("#f-dest").focus();
}

function readTripForm() {
  const destination = $("#f-dest").value.trim();
  const people = ALL_IDS.filter((id) => picked.has(id));
  if (!destination) { tripError("Add where you're going.", "#f-dest"); return null; }
  if (!people.length) { tripError("Pick who's going."); return null; }
  return {
    destination,
    arrive: arrivePicker.value,
    depart: departPicker.value < arrivePicker.value ? arrivePicker.value : departPicker.value,
    people,
    guests: $("#f-guests").value.trim(),
    details: $("#f-details").value.trim(),
  };
}

async function saveTrip({ status, message }) {
  const data = readTripForm();
  if (!data) return;
  const btns = tripForm.querySelectorAll("button");
  btns.forEach((b) => (b.disabled = true));
  try {
    if (editingTrip) {
      await updateDoc(doc(db, "trips", editingTrip.id), {
        ...data,
        ...(status ? { status } : {}),
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, "trips"), {
        ...data,
        status: tripForm.elements.status.value === "booked" ? "booked" : "planned",
        deleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    tripDlg.close();
    toast(message);
  } catch (err) {
    console.error(err);
    tripError("Couldn't save. Check your connection and try again.");
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

tripForm.addEventListener("submit", (e) => {
  e.preventDefault();
  saveTrip({ message: editingTrip ? "Changes saved" : "Trip added" });
});

$("#trip-status-toggle").addEventListener("click", () => {
  if (!editingTrip) return;
  const next = editingTrip.status === "booked" ? "planned" : "booked";
  saveTrip({ status: next, message: next === "booked" ? "Marked as booked" : "Moved back to planned" });
});

async function deleteTrip() {
  if (!editingTrip) return;
  const ref = doc(db, "trips", editingTrip.id);
  try {
    await updateDoc(ref, { deleted: true, updatedAt: serverTimestamp() });
    tripDlg.close();
    toast("Trip deleted", () => updateDoc(ref, { deleted: false, updatedAt: serverTimestamp() }));
  } catch (err) {
    console.error(err);
    tripError("Couldn't delete. Check your connection and try again.");
  }
}

/* ---------- Note dialog ---------- */
const noteDlg = $("#note-dialog");
const noteForm = $("#note-form");
let editingNote = null;
const notePicker = new DatePicker($("#n-date"), { min: CALENDAR_START, max: CALENDAR_END });

function openNote({ row, note }) {
  editingNote = note || null;
  $("#note-title").textContent = note ? "Edit note" : "Add note";
  $("#note-save").textContent = note ? "Save changes" : "Add note";
  $("#n-text").value = note?.text || "";
  notePicker.set(note ? note.date : row.start);
  $("#note-error").textContent = "";
  const del = $("#note-delete");
  del.hidden = !note;
  if (note) armDelete(del, "Delete note", deleteNote);
  noteDlg.showModal();
  $("#n-text").focus();
}

noteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#n-text").value.trim();
  if (!text) { $("#note-error").textContent = "Write the note first."; $("#n-text").focus(); return; }
  const data = { text, date: notePicker.value };
  const btns = noteForm.querySelectorAll("button");
  btns.forEach((b) => (b.disabled = true));
  try {
    if (editingNote) {
      await updateDoc(doc(db, "notes", editingNote.id), { ...data, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "notes"), {
        ...data,
        deleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    noteDlg.close();
    toast(editingNote ? "Changes saved" : "Note added");
  } catch (err) {
    console.error(err);
    $("#note-error").textContent = "Couldn't save. Check your connection and try again.";
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
});

async function deleteNote() {
  if (!editingNote) return;
  const ref = doc(db, "notes", editingNote.id);
  try {
    await updateDoc(ref, { deleted: true, updatedAt: serverTimestamp() });
    noteDlg.close();
    toast("Note deleted", () => updateDoc(ref, { deleted: false, updatedAt: serverTimestamp() }));
  } catch (err) {
    console.error(err);
    $("#note-error").textContent = "Couldn't delete. Check your connection and try again.";
  }
}

/* ---------- Start ---------- */
buildFilter();
buildTimeline();
