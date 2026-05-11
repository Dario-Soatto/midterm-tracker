// List exactly which races are in our catalog but missing from the prices
// table — i.e. which Kalshi events returned no usable D/R prices.

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { HOUSE_TICKERS, SENATE_TICKERS } from "../lib/kalshi/catalog.ts";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT event_ticker, kind, race_key FROM prices`;
const haveByKind = { district: new Set(), senate: new Set() };
const haveTickers = new Set();
for (const r of rows) {
  haveByKind[r.kind]?.add(r.race_key);
  haveTickers.add(r.event_ticker);
}

console.log(`DB rows: ${rows.length}`);
console.log(`  district: ${haveByKind.district.size}`);
console.log(`  senate:   ${haveByKind.senate.size}\n`);

console.log("=== Missing HOUSE districts ===");
for (const [geoid, ticker] of Object.entries(HOUSE_TICKERS)) {
  if (!haveByKind.district.has(geoid)) {
    console.log(`  ${geoid}  ${ticker}`);
  }
}

console.log("\n=== Missing SENATE races ===");
for (const [abbr, ticker] of Object.entries(SENATE_TICKERS)) {
  if (!haveByKind.senate.has(abbr)) {
    console.log(`  ${abbr}  ${ticker}`);
  }
}
