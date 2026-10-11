// Site settings. Edit these to change who's in the group or which dates show.

// Everyone in the group, in the order they appear on the site.
// `home` is where they live (not shown on the page right now).
// Colors are set in css/style.css (--p-<id>).
export const PEOPLE = [
  { id: "sam", name: "Sam", home: "Barcelona" },
  { id: "casey", name: "Casey", home: "Madrid" },
  { id: "alex", name: "Alex", home: "Barcelona" },
  { id: "julia", name: "Julia", home: "Barcelona" },
  { id: "lindsay", name: "Lindsay", home: "Barcelona" },
  { id: "alanna", name: "Alanna", home: "Barcelona" },
];

// Weekends run Thursday to Sunday. These are the first and last Thursdays shown.
export const SEASON_START = "2027-01-07";
export const SEASON_END = "2027-05-13";

// Longer stretches shown as a single row instead of separate weekends.
export const BREAKS = [
  { start: "2027-03-18", end: "2027-03-29", label: "Spring break" },
];

// The range of dates the calendars let you pick.
export const CALENDAR_START = "2027-01-01";
export const CALENDAR_END = "2027-05-31";
