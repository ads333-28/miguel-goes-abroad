// Site settings. Edit these to change who's in the group or which weekends show.

// Everyone in the group, in the order they appear on the site.
// `home` is where they live; it's shown when they have no trip that weekend.
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
