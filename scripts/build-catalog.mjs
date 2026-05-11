// Build lib/kalshi/catalog.ts from tmp/kalshi-catalog.json.
//
// House:
//   Auto-derive (geoid → ticker) for all 435 voting districts. Two ticker
//   patterns coexist on Kalshi; we prefer the comprehensive `KXHOUSERACE-`
//   format and fall back to the legacy `(KX)?HOUSE` form. DC's at-large
//   delegate is intentionally excluded (non-voting member, doesn't count
//   toward the chamber majority).
//
// Senate:
//   35 contested races in 2026 (33 Class 2 regular + FL special + OH special).
//   Most map cleanly to `SENATE<ABBR>-26`. A handful of overrides:
//     • KY: SENATELA-26     (Kalshi typo'd the ticker as LA, title is correct)
//     • LA: KXSENATELA-26   (event exists but markets not yet listed)
//     • FL: SENATEFLS-26    (special)
//     • OH: SENATEOHS-26    (special)
//
// Usage:
//   1. node scripts/discover-kalshi.mjs   # refresh raw catalog
//   2. node scripts/build-catalog.mjs     # → lib/kalshi/catalog.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const cat = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tmp/kalshi-catalog.json"), "utf8"),
);

const FIPS = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
  TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
  WI: "55", WY: "56",
};

const SENATE_2026 = new Set(
  "AL AK AR CO DE FL GA IA ID IL KS KY LA MA ME MI MN MS MT NC NE NH NJ NM OH OK OR RI SC SD TN TX VA WV WY".split(
    /\s+/,
  ),
);

// --- HOUSE -----------------------------------------------------------------

/** geoid → ticker. Resolves duplicates by preferring KXHOUSERACE-. */
function buildHouse() {
  const out = {};
  // first pass: stash any matching event keyed by geoid, with priority
  const candidates = {}; // geoid → [{ticker, priority}]
  for (const e of cat.events.house) {
    const t = e.event_ticker;
    let abbr, num, priority;

    let m = t.match(/^KXHOUSERACE-([A-Z]{2})(\d+|AL)-26$/);
    if (m) {
      abbr = m[1];
      num = m[2];
      priority = 0; // best
    } else if ((m = t.match(/^(?:KX)?HOUSE([A-Z]{2})(\d+|AL)-26$/))) {
      abbr = m[1];
      num = m[2];
      priority = 1; // legacy fallback
    } else {
      continue;
    }

    if (abbr === "DC") continue; // non-voting delegate, skip
    const fips = FIPS[abbr];
    if (!fips) continue;
    const cd = num === "AL" ? "00" : String(parseInt(num, 10)).padStart(2, "0");
    const geoid = fips + cd;

    candidates[geoid] = candidates[geoid] || [];
    candidates[geoid].push({ ticker: t, priority });
  }

  for (const [geoid, list] of Object.entries(candidates)) {
    list.sort((a, b) => a.priority - b.priority);
    out[geoid] = list[0].ticker;
  }
  return out;
}

const houseTickers = buildHouse();

// --- SENATE ----------------------------------------------------------------

const SENATE_OVERRIDES = {
  KY: "SENATELA-26",      // Kalshi typo: ticker says LA but it's the Kentucky race
  LA: "KXSENATELA-26NOV", // Louisiana uses the -26NOV suffix (a sibling
                          // event ticker KXSENATELA-26 exists but is empty)
  FL: "SENATEFLS-26",     // Florida special election
  OH: "SENATEOHS-26",     // Ohio special election
};

/** abbr → ticker. Uses overrides; auto-derives the rest as SENATE<ABBR>-26. */
function buildSenate() {
  const out = { ...SENATE_OVERRIDES };
  // index discovery results by upper(stateCode)
  const byCode = {};
  for (const e of cat.events.senate) {
    const m = e.event_ticker.match(/^(?:KX)?SENATE([A-Z]+?)-26$/);
    if (!m) continue;
    byCode[m[1]] = e.event_ticker;
  }
  for (const abbr of SENATE_2026) {
    if (out[abbr]) continue;
    if (byCode[abbr]) out[abbr] = byCode[abbr];
  }
  return out;
}

const senateTickers = buildSenate();

// --- KALSHI URLs from sitemap ----------------------------------------------
//
// Kalshi requires the SEO slug in the URL ("california-governors-race") for
// the SPA to actually render the market — the slugless form 404s. The slug
// isn't exposed via the trade API, but kalshi.com/sitemap-markets.xml lists
// every market with its full canonical URL. We grab those once at build time.

console.log("\nFetching Kalshi market sitemap for canonical URLs...");
const sitemapXml = await fetch("https://kalshi.com/sitemap-markets.xml").then(
  (r) => r.text(),
);
const urlByTicker = {};
for (const m of sitemapXml.matchAll(
  /<loc>(https:\/\/kalshi\.com\/markets\/[^<]+)<\/loc>/g,
)) {
  const url = m[1];
  const parts = url.split("/").filter(Boolean);
  const eventLower = parts[parts.length - 1];
  urlByTicker[eventLower.toUpperCase()] = url;
}
console.log(`  parsed ${Object.keys(urlByTicker).length} URLs from sitemap`);

const kalshiUrls = {};
const allOurTickers = new Set([
  ...Object.values(houseTickers),
  ...Object.values(senateTickers),
]);
let urlMatched = 0;
for (const t of allOurTickers) {
  const u = urlByTicker[t];
  if (u) {
    kalshiUrls[t] = u;
    urlMatched++;
  }
}
console.log(
  `  matched ${urlMatched} / ${allOurTickers.size} of our event tickers`,
);
const missingFromSitemap = [...allOurTickers].filter((t) => !kalshiUrls[t]);
if (missingFromSitemap.length > 0 && missingFromSitemap.length < 10) {
  console.log("  unmatched tickers:", missingFromSitemap.join(", "));
} else if (missingFromSitemap.length > 0) {
  console.log(
    `  ${missingFromSitemap.length} unmatched (showing first 5):`,
    missingFromSitemap.slice(0, 5).join(", "),
  );
}

// --- COVERAGE CHECK --------------------------------------------------------

const expectedDistricts = (() => {
  // count voting districts per state from the FIPS+CD universe; we trust the
  // 435 number and don't have a per-state truth table here, so just use the
  // catalog as the universe (which we know covers all 435 + DC).
  const count = {};
  for (const geoid of Object.keys(houseTickers)) {
    const f = geoid.slice(0, 2);
    count[f] = (count[f] || 0) + 1;
  }
  return count;
})();

const houseCount = Object.keys(houseTickers).length;
const senateCount = Object.keys(senateTickers).length;
const senateMissing = [...SENATE_2026].filter((a) => !senateTickers[a]);

console.log(`House mapped:  ${houseCount} (target: 435)`);
console.log(`Senate mapped: ${senateCount} (target: ${SENATE_2026.size})`);
if (senateMissing.length > 0)
  console.log(`! Senate missing: ${senateMissing.join(", ")}`);

if (houseCount !== 435) {
  console.error(`! House coverage incomplete: ${houseCount}/435`);
  process.exit(1);
}
if (senateMissing.length > 0) {
  console.error(`! Senate coverage incomplete`);
  process.exit(1);
}

// --- WRITE -----------------------------------------------------------------

const tsPath = path.join(ROOT, "lib/kalshi/catalog.ts");
fs.mkdirSync(path.dirname(tsPath), { recursive: true });

const fmtMap = (m) =>
  Object.entries(m)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  "${k}": "${v}",`)
    .join("\n");

const ts = `// AUTO-GENERATED — do not edit by hand.
// Regenerate after Kalshi adds/removes events:
//   1. node scripts/discover-kalshi.mjs
//   2. node scripts/build-catalog.mjs
//
// Generated: ${new Date().toISOString()}
// Coverage:  House ${houseCount}/435 · Senate ${senateCount}/${SENATE_2026.size}

/** GEOID (state-fips + 2-digit-cd) → Kalshi event ticker. */
export const HOUSE_TICKERS: Record<string, string> = {
${fmtMap(houseTickers)}
};

/** State abbreviation → Kalshi event ticker. */
export const SENATE_TICKERS: Record<string, string> = {
${fmtMap(senateTickers)}
};

/**
 * Event ticker → canonical kalshi.com URL (from sitemap-markets.xml).
 * Kalshi's SPA requires the SEO slug to actually render the market, so we
 * pre-resolve the full URL at catalog build time. Tickers without an entry
 * here aren't indexed by Kalshi yet (or we have a stale sitemap).
 *
 * Sitemap matched ${urlMatched} / ${allOurTickers.size} of our tickers.
 */
export const KALSHI_URLS: Record<string, string> = {
${fmtMap(kalshiUrls)}
};
`;

fs.writeFileSync(tsPath, ts);
console.log(`\nWrote ${tsPath}`);
console.log(`\nDistricts per state:`);
for (const [f, c] of Object.entries(expectedDistricts).sort()) {
  const abbr = Object.keys(FIPS).find((k) => FIPS[k] === f);
  console.log(`  ${abbr} (${f}): ${c}`);
}
