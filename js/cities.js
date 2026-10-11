// Cities that have recommendations from the abroad guides, and the words
// that point to them in a trip's destination ("London", "Amalfi Coast"...).

export const CATEGORIES = [
  ["eat", "Eat"],
  ["drink", "Drinks and going out"],
  ["do", "See and do"],
  ["shop", "Shopping"],
  ["stay", "Where to stay"],
  ["tips", "Good to know"],
];

// slug: [display name, ...words that mean this city]
const CITIES = {
  "madrid": ["Madrid", "madrid"],
  "barcelona": ["Barcelona", "barcelona", "barca", "barce"],
  "ibiza": ["Ibiza", "ibiza"],
  "mallorca": ["Mallorca", "mallorca", "majorca", "palma"],
  "tenerife": ["Tenerife", "tenerife", "canary islands", "canaries"],
  "san-sebastian": ["San Sebastián", "san sebastian", "san seb", "donostia", "bilbao"],
  "lisbon": ["Lisbon", "lisbon", "lisboa"],
  "sintra": ["Sintra", "sintra"],
  "porto": ["Porto", "porto", "oporto", "douro"],
  "lagos": ["Lagos", "lagos", "algarve"],
  "paris": ["Paris", "paris"],
  "nice": ["Nice", "nice"],
  "cannes": ["Cannes", "cannes"],
  "monaco": ["Monaco", "monaco", "monte carlo"],
  "london": ["London", "london"],
  "edinburgh": ["Edinburgh", "edinburgh", "scotland"],
  "dublin": ["Dublin", "dublin", "ireland"],
  "amsterdam": ["Amsterdam", "amsterdam", "netherlands", "holland"],
  "brussels": ["Brussels", "brussels", "bruxelles"],
  "bruges": ["Bruges", "bruges", "brugge"],
  "copenhagen": ["Copenhagen", "copenhagen", "kobenhavn", "denmark"],
  "berlin": ["Berlin", "berlin"],
  "munich": ["Munich", "munich", "munchen", "oktoberfest"],
  "prague": ["Prague", "prague", "praha", "czech"],
  "budapest": ["Budapest", "budapest", "hungary"],
  "krakow": ["Kraków", "krakow", "cracow", "auschwitz"],
  "st-anton": ["St. Anton", "st anton", "sankt anton"],
  "interlaken": ["Interlaken", "interlaken", "grindelwald"],
  "lucerne": ["Lucerne", "lucerne", "luzern"],
  "zurich": ["Zurich", "zurich"],
  "rome": ["Rome", "rome", "roma"],
  "florence": ["Florence", "florence", "firenze"],
  "siena": ["Siena", "siena", "chianti"],
  "cinque-terre": ["Cinque Terre", "cinque terre", "monterosso"],
  "venice": ["Venice", "venice", "venezia"],
  "positano": ["Positano", "positano"],
  "capri": ["Capri", "capri"],
  "sorrento": ["Sorrento", "sorrento"],
  "marrakech": ["Marrakech", "marrakech", "marrakesh", "morocco", "sahara"],
  "malta": ["Malta", "malta", "valletta"],
};

// Words for a whole region that cover several cities.
const REGIONS = [
  [["amalfi coast", "amalfi", "naples", "napoli"], ["positano", "capri", "sorrento"]],
  [["switzerland", "swiss alps", "swiss"], ["interlaken", "lucerne", "zurich"]],
  [["south of france", "french riviera", "riviera", "cote d azur"], ["nice", "cannes", "monaco"]],
  [["tuscany"], ["florence", "siena"]],
  [["portugal"], ["lisbon", "porto"]],
  [["belgium"], ["brussels", "bruges"]],
  [["germany"], ["berlin", "munich"]],
];

// Day trips worth showing alongside a city.
const NEARBY = {
  lisbon: ["sintra"],
  brussels: ["bruges"],
  florence: ["cinque-terre", "siena"],
};

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const slugify = (s) => norm(s).replace(/\s+/g, "-");
// Words that describe a trip rather than name a place.
const FILLER = new Set("trip weekend day visit visiting family friends girls boys spring break the a with our maybe ski in".split(" "));
const titleCase = (s) => s.replace(/\s+/g, " ").trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

function matchesIn(text) {
  const t = ` ${norm(text)} `;
  const hits = [];
  const find = (word) => t.indexOf(` ${norm(word)} `);
  for (const [slug, [, ...words]] of Object.entries(CITIES)) {
    const at = Math.min(...words.map(find).filter((i) => i >= 0));
    if (Number.isFinite(at)) hits.push([at, slug]);
  }
  for (const [words, slugs] of REGIONS) {
    const at = Math.min(...words.map(find).filter((i) => i >= 0));
    if (Number.isFinite(at)) slugs.forEach((slug, k) => hits.push([at + k / 100, slug]));
  }
  return hits.sort((a, b) => a[0] - b[0]).map(([, slug]) => slug);
}

// The places a trip covers, in the order they're named, e.g.
// "Barcelona → Morocco" gives Barcelona then Marrakech. Places with no
// guide recs still get an entry, so people can add their own.
export function placesFor(destination) {
  const out = [];
  const seen = new Set();
  const add = (slug, name, known, nearby = false) => {
    if (seen.has(slug)) return;
    seen.add(slug);
    out.push({ slug, name, known, nearby });
  };
  const parts = destination.split(/→|->|—|–|\/|,|&|\+|\band\b|\bthen\b/i).map((p) => p.replace(/[?!()]/g, " ").trim()).filter(Boolean);
  for (const part of parts) {
    const slugs = matchesIn(part);
    if (slugs.length) slugs.forEach((slug) => add(slug, CITIES[slug][0], true));
    else if (norm(part).split(" ").some((w) => w.length > 2 && !FILLER.has(w))) add(`x-${slugify(part)}`, titleCase(part), false);
  }
  for (const p of out.slice()) {
    for (const slug of NEARBY[p.slug] || []) add(slug, CITIES[slug][0], true, true);
  }
  return out;
}
