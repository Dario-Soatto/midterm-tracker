// One-off Kalshi catalog dump.
//
// Crawls every series in the elections category, fetches all events for each,
// filters to 2026-relevant ones, and writes a structured catalog to
// tmp/kalshi-catalog.json. Prints a summary so we can decide how to map
// (district / state) → (Kalshi event ticker).
//
// Usage:  cd midterms-2026 && node scripts/discover-kalshi.mjs

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const envText = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const API_KEY_ID = envText.match(/KALSHI_API_KEY_ID=(.+)/)?.[1].trim();
const PRIVATE_KEY = envText.match(/KALSHI_PRIVATE_KEY="([\s\S]+?)"/)?.[1];
if (!API_KEY_ID || !PRIVATE_KEY) {
  console.error("Missing Kalshi credentials in .env.local");
  process.exit(1);
}

const BASE = "https://api.elections.kalshi.com";

async function signedFetch(pathname) {
  const ts = Date.now().toString();
  const sig = crypto
    .sign("sha256", Buffer.from(ts + "GET" + pathname.split("?")[0]), {
      key: PRIVATE_KEY,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");
  const res = await fetch(BASE + pathname, {
    headers: {
      "KALSHI-ACCESS-KEY": API_KEY_ID,
      "KALSHI-ACCESS-SIGNATURE": sig,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${pathname} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function paginate(pathname, key) {
  const items = [];
  let cursor = "";
  for (let i = 0; i < 80; i++) {
    const url =
      pathname +
      (pathname.includes("?") ? "&" : "?") +
      "limit=200" +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const data = await signedFetch(url);
    const list = data[key] || [];
    items.push(...list);
    cursor = data.cursor;
    if (!cursor || list.length === 0) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return items;
}

function bucketOf(seriesTicker) {
  const t = seriesTicker.toUpperCase();
  if (/(^|[^A-Z])SEN/.test(t)) return "senate";
  if (/(GOV|GUV)/.test(t)) return "governor";
  if (/(HSE|HOUSE|HR|CONG)/.test(t)) return "house";
  return "other";
}

function is2026(eventTicker, eventTitle = "", subTitle = "") {
  const txt = `${eventTicker} ${eventTitle} ${subTitle}`;
  return /-26\b|\b2026\b/i.test(txt);
}

console.log("Step 1 / 2 — listing all elections series...");
let series = [];
try {
  series = await paginate(
    "/trade-api/v2/series?category=Elections",
    "series",
  );
} catch (e) {
  console.error("Failed with category=Elections, retrying without filter:");
  console.error("  " + e.message);
  series = await paginate("/trade-api/v2/series", "series");
}
console.log(`  found ${series.length} series total`);

const electionish = series.filter((s) => bucketOf(s.ticker) !== "other");
console.log(`  ${electionish.length} look like senate/house/governor`);

const buckets = { senate: [], house: [], governor: [], other: [] };

console.log("\nStep 2 / 2 — fetching events per series...");
let processed = 0;
for (const s of electionish) {
  processed++;
  const bucket = bucketOf(s.ticker);
  let events;
  try {
    events = await paginate(
      `/trade-api/v2/events?series_ticker=${encodeURIComponent(s.ticker)}`,
      "events",
    );
  } catch (e) {
    console.error(`  ! ${s.ticker}: ${e.message}`);
    continue;
  }
  const events2026 = events.filter((e) =>
    is2026(e.event_ticker, e.title, e.sub_title),
  );
  for (const ev of events2026) {
    buckets[bucket].push({
      series_ticker: s.ticker,
      series_title: s.title,
      event_ticker: ev.event_ticker,
      title: ev.title,
      sub_title: ev.sub_title ?? "",
    });
  }
  if (processed % 10 === 0)
    process.stdout.write(`  …processed ${processed}/${electionish.length}\r`);
  await new Promise((r) => setTimeout(r, 60));
}
console.log("");

const tmpDir = path.join(ROOT, "tmp");
fs.mkdirSync(tmpDir, { recursive: true });
const outPath = path.join(tmpDir, "kalshi-catalog.json");
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      series_total: series.length,
      election_series: electionish.length,
      counts: {
        senate: buckets.senate.length,
        house: buckets.house.length,
        governor: buckets.governor.length,
      },
      events: buckets,
    },
    null,
    2,
  ),
);

console.log("\n=== SUMMARY ===");
console.log(`  senate 2026 events:    ${buckets.senate.length}`);
console.log(`  house 2026 events:     ${buckets.house.length}`);
console.log(`  governor 2026 events:  ${buckets.governor.length}`);
console.log(`\nWrote ${outPath}`);

for (const [name, items] of Object.entries(buckets)) {
  if (name === "other" || items.length === 0) continue;
  console.log(`\n--- ${name.toUpperCase()} (first 15) ---`);
  for (const it of items.slice(0, 15)) {
    const sub = it.sub_title ? `  [${it.sub_title}]` : "";
    console.log(`  ${it.event_ticker.padEnd(28)} ${it.title}${sub}`);
  }
  if (items.length > 15) console.log(`  ... +${items.length - 15} more`);
}
