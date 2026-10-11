// Small helpers shared by every page.
import { PEOPLE } from "./config.js?v=4";
import { addDays } from "./datepicker.js?v=4";

export const $ = (sel, root = document) => root.querySelector(sel);
export const PERSON = new Map(PEOPLE.map((p) => [p.id, p]));
export const ALL_IDS = PEOPLE.map((p) => p.id);

// Build an element. Text is always set as text, never as HTML.
export function el(tag, props = {}, ...kids) {
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

export function swatch(id) {
  const s = el("span", { class: "swatch", "aria-hidden": "true" });
  s.style.setProperty("--c", `var(--p-${id})`);
  return s;
}

// Octagon status mark: filled when booked, outlined when planned.
export function mark() {
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

export function listText(names) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

// "Julia and Alanna", or "Everyone" when the whole group is listed.
export function peopleText(ids) {
  const people = ALL_IDS.filter((id) => ids.includes(id));
  if (people.length === ALL_IDS.length) return "Everyone";
  return listText(people.map((id) => PERSON.get(id).name));
}

export const ms = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : Number.MAX_SAFE_INTEGER);
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// A trip's arrival and departure. Older entries were saved with only a
// weekend; read those as Thursday–Sunday.
export function tripDates(t) {
  const a = isDate(t.arrive) ? t.arrive : isDate(t.weekend) ? t.weekend : null;
  if (!a) return null;
  let d = isDate(t.depart) ? t.depart : isDate(t.weekend) ? addDays(t.weekend, 3) : a;
  if (d < a) d = a;
  return [a, d];
}

/* ---------- Toast ---------- */
let toastTimer;
export function toast(text, undo) {
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

/* ---------- Dialogs ---------- */
export function setupDialogs() {
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
    // Clear the form's error as soon as someone changes something.
    const err = dlg.querySelector(".form-error");
    if (err) {
      dlg.addEventListener("input", () => { err.textContent = ""; });
      dlg.addEventListener("click", (e) => { if (e.target.closest("[data-pick], .cal-day, .seg")) err.textContent = ""; });
    }
  }
}

// A delete button that asks for a second tap before acting.
export function armDelete(btn, label, onConfirm) {
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

// Run a save, keeping the form's buttons disabled while it's in flight.
export async function withBusy(form, errorEl, fn) {
  const btns = form.querySelectorAll("button");
  btns.forEach((b) => (b.disabled = true));
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Couldn't save. Check your connection and try again.";
    return false;
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

/* ---------- Picking people ---------- */
// Toggle chips for choosing people, with an "Everyone" shortcut.
export class PeoplePicker {
  constructor(container, { allLabel = "Everyone" } = {}) {
    this.box = container;
    this.allLabel = allLabel;
    this.options = ALL_IDS.slice();
    this.picked = new Set();
    this.box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      const id = b.dataset.pick;
      if (id === "all") this.picked = this.options.every((x) => this.picked.has(x)) ? new Set() : new Set(this.options);
      else if (this.picked.has(id)) this.picked.delete(id);
      else this.picked.add(id);
      this.sync();
    });
    this.render();
  }

  // Limit the choices, e.g. to the people on a trip.
  setOptions(ids) {
    this.options = ALL_IDS.filter((id) => ids.includes(id));
    this.render();
  }

  set(ids) {
    this.picked = new Set(ids.filter((id) => this.options.includes(id)));
    this.sync();
  }

  get value() {
    return this.options.filter((id) => this.picked.has(id));
  }

  render() {
    const chips = this.options.map((id) =>
      el("button", { type: "button", class: "pick-chip", dataset: { pick: id }, "aria-pressed": "false" }, swatch(id), PERSON.get(id).name));
    if (this.options.length > 1) {
      chips.unshift(el("button", { type: "button", class: "pick-chip", dataset: { pick: "all" }, "aria-pressed": "false" }, this.allLabel));
    }
    this.box.replaceChildren(...chips);
    this.sync();
  }

  sync() {
    for (const b of this.box.querySelectorAll("[data-pick]")) {
      const id = b.dataset.pick;
      const on = id === "all" ? this.options.every((x) => this.picked.has(x)) : this.picked.has(id);
      b.setAttribute("aria-pressed", String(on));
    }
  }
}

// Segmented control (radio-like buttons). Returns get/set helpers.
export function segmented(container, options, onChange) {
  let value = options[0][0];
  container.classList.add("seg");
  container.setAttribute("role", "radiogroup");
  container.replaceChildren(...options.map(([v, label]) =>
    el("button", { type: "button", role: "radio", "aria-checked": "false", dataset: { value: v } }, label)));
  const sync = () => {
    for (const b of container.querySelectorAll("[data-value]")) b.setAttribute("aria-checked", String(b.dataset.value === value));
  };
  container.addEventListener("click", (e) => {
    const b = e.target.closest("[data-value]");
    if (!b) return;
    value = b.dataset.value;
    sync();
    onChange?.(value);
  });
  sync();
  return {
    get value() { return value; },
    set value(v) { value = v; sync(); },
  };
}
