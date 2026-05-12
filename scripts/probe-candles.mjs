// Diagnostic: dump raw Kalshi candlesticks for one market so we can see
// why our /api/history endpoint emits so few points. Usage:
//   node scripts/probe-candles.mjs HOUSEAZ2-26 7 60
//   node scripts/probe-candles.mjs HOUSEAZ2-26 7 1

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const envText = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const API_KEY_ID = envText.match(/KALSHI_API_KEY_ID=(.+)/)?.[1].trim();
const PRIVATE_KEY = envText.match(/KALSHI_PRIVATE_KEY="([\s\S]+?)"/)?.[1];

const BASE = "https://api.elections.kalshi.com";

async function kalshiGet(pathname) {
  const ts = Date.now().toString();
  const pathOnly = pathname.split("?")[0];
  const sig = crypto
    .sign("sha256", Buffer.from(ts + "GET" + pathOnly), {
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
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const eventTicker = process.argv[2] ?? "HOUSEAZ2-26";
const days = parseInt(process.argv[3] ?? "7", 10);
const period = parseInt(process.argv[4] ?? "60", 10);

const series = eventTicker.startsWith("KXHOUSERACE-")
  ? "KXHOUSERACE"
  : eventTicker.replace(/-\d+[A-Z0-9]*$/, "");
const market = `${eventTicker}-D`;
const end = Math.floor(Date.now() / 1000);
const start = end - days * 86400;
const url = `/trade-api/v2/series/${series}/markets/${market}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${period}`;

console.log(`series=${series}  market=${market}  days=${days}  period=${period}min  url=${url}`);
const data = await kalshiGet(url);
const candles = data.candlesticks ?? [];
console.log(`raw candles returned: ${candles.length}`);

// Classify each candle
let withMid = 0, withPrevOnly = 0, withBidOnly = 0, withAskOnly = 0, empty = 0;
for (const c of candles) {
  const b = parseFloat(c.yes_bid?.close_dollars ?? "");
  const a = parseFloat(c.yes_ask?.close_dollars ?? "");
  const p = parseFloat(c.price?.previous_dollars ?? "");
  const has = (x) => Number.isFinite(x) && x > 0;
  if (has(b) && has(a)) withMid++;
  else if (has(b)) withBidOnly++;
  else if (has(a)) withAskOnly++;
  else if (has(p)) withPrevOnly++;
  else empty++;
}
console.log(`  midpoint available (bid+ask both > 0): ${withMid}`);
console.log(`  bid only:                             ${withBidOnly}`);
console.log(`  ask only:                             ${withAskOnly}`);
console.log(`  previous_dollars only:                ${withPrevOnly}`);
console.log(`  totally empty:                        ${empty}`);

// Dump a handful of raw candles to see what fields look like in practice.
console.log("\nfirst 3 candles:");
for (const c of candles.slice(0, 3)) console.log(" ", JSON.stringify(c));
console.log("\nlast 3 candles:");
for (const c of candles.slice(-3)) console.log(" ", JSON.stringify(c));

// Sample a candle from the middle to see a non-trading-hour case
const midIdx = Math.floor(candles.length / 2);
console.log(`\nmid candle (idx ${midIdx}):`, JSON.stringify(candles[midIdx]));
