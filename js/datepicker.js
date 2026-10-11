// A drop-down calendar for picking one date, opened from a button.
// Dates are plain "YYYY-MM-DD" strings everywhere.

const DAY = 86400000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const toISO = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => toISO(new Date(parseISO(s).getTime() + n * DAY));
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY);

// "Thu, Feb 11"
export function shortDate(s) {
  const d = parseISO(s);
  return `${WEEKDAY[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// "2/11"
export function md(s) {
  const d = parseISO(s);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function longDate(s) {
  const d = parseISO(s);
  return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export class DatePicker {
  constructor(button, { min, max, onChange } = {}) {
    this.button = button;
    this.min = min;
    this.max = max;
    this.onChange = onChange;
    this.value = min;
    this.floor = null;      // earliest date that can be picked (e.g. the arrival date)
    this.rangeStart = null; // shade the days from here to the picked date

    this.pop = document.createElement("div");
    this.pop.className = "cal";
    this.pop.hidden = true;
    this.pop.setAttribute("role", "dialog");
    this.pop.setAttribute("aria-label", "Choose a date");
    this.pop.picker = this;
    button.parentElement.append(this.pop);

    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => (this.pop.hidden ? this.open() : this.close()));

    this.pop.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) { this.shiftMonth(Number(nav.dataset.nav)); return; }
      const day = e.target.closest("[data-date]");
      if (day && !day.disabled) {
        this.set(day.dataset.date);
        this.close();
        this.button.focus();
        this.onChange?.(this.value);
      }
    });

    this.pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); this.button.focus(); }
    });

    document.addEventListener("pointerdown", (e) => {
      if (!this.pop.hidden && !this.pop.contains(e.target) && !this.button.contains(e.target)) this.close();
    });
  }

  set(value) {
    this.value = value;
    this.button.textContent = shortDate(value);
    this.button.setAttribute("aria-label", `${this.button.dataset.label || "Date"}: ${longDate(value)}`);
  }

  open() {
    const d = parseISO(this.value);
    this.viewYear = d.getUTCFullYear();
    this.viewMonth = d.getUTCMonth();
    this.render();
    this.pop.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    (this.pop.querySelector(".is-sel") || this.pop.querySelector("[data-date]:not(:disabled)"))?.focus();
  }

  close() {
    if (this.pop.hidden) return;
    this.pop.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }

  shiftMonth(n) {
    const d = new Date(Date.UTC(this.viewYear, this.viewMonth + n, 1));
    this.viewYear = d.getUTCFullYear();
    this.viewMonth = d.getUTCMonth();
    this.render();
  }

  render() {
    const first = new Date(Date.UTC(this.viewYear, this.viewMonth, 1));
    const lastOfMonth = toISO(new Date(Date.UTC(this.viewYear, this.viewMonth + 1, 0)));
    const start = toISO(new Date(first.getTime() - first.getUTCDay() * DAY));
    const lowest = this.floor && this.floor > this.min ? this.floor : this.min;

    const head = document.createElement("div");
    head.className = "cal-head";
    const title = document.createElement("span");
    title.className = "cal-title";
    title.textContent = `${MONTHS[this.viewMonth]} ${this.viewYear}`;
    const prev = navButton("‹", "Previous month", -1, toISO(first) <= this.min);
    const next = navButton("›", "Next month", 1, lastOfMonth >= this.max);
    head.append(title, prev, next);

    const grid = document.createElement("div");
    grid.className = "cal-grid";
    for (const l of DOW) {
      const s = document.createElement("span");
      s.className = "cal-dow";
      s.setAttribute("aria-hidden", "true");
      s.textContent = l;
      grid.append(s);
    }
    for (let i = 0; i < 42; i++) {
      const iso = addDays(start, i);
      const d = parseISO(iso);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cal-day";
      b.dataset.date = iso;
      b.textContent = String(d.getUTCDate());
      b.setAttribute("aria-label", longDate(iso));
      if (d.getUTCMonth() !== this.viewMonth) b.classList.add("is-out");
      if (iso < lowest || iso > this.max) b.disabled = true;
      if (iso === this.value) { b.classList.add("is-sel"); b.setAttribute("aria-pressed", "true"); }
      else if (this.rangeStart && iso >= this.rangeStart && iso < this.value) b.classList.add("is-range");
      grid.append(b);
    }
    this.pop.replaceChildren(head, grid);
  }
}

function navButton(text, label, dir, disabled) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cal-nav";
  b.textContent = text;
  b.setAttribute("aria-label", label);
  b.dataset.nav = String(dir);
  b.disabled = disabled;
  return b;
}
