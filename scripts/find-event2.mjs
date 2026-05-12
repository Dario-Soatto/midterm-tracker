// Search the /events endpoint for a needle.
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
  const sig = crypto.sign("sha256", Buffer.from(ts + "GET" + pathname.split("?")[0]), {
    key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
  const res = await fetch(BASE + pathname, {
    headers: {"KALSHI-ACCESS-KEY": API_KEY_ID, "KALSHI-ACCESS-SIGNATURE": sig,
              "KALSHI-ACCESS-TIMESTAMP": ts, Accept: "application/json"},
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const needle = (process.argv[2] ?? "NC11").toUpperCase();

// 1. Try fetching the specific event directly
console.log(`\n=== try GET /events/KXHOUSENC11-26 ===`);
try {
  const d = await kalshiGet(`/trade-api/v2/events/KXHOUSENC11-26`);
  console.log(JSON.stringify(d, null, 2).slice(0, 800));
} catch (e) { console.log("ERR:", e.message); }

// 2. Try Series listing
console.log(`\n=== try GET /series/KXHOUSENC11 ===`);
try {
  const d = await kalshiGet(`/trade-api/v2/series/KXHOUSENC11`);
  console.log(JSON.stringify(d, null, 2).slice(0, 800));
} catch (e) { console.log("ERR:", e.message); }

// 3. Scan events
let cursor = "";
let total = 0, hits = [];
for (let i = 0; i < 30; i++) {
  const url = `/trade-api/v2/events?limit=200${cursor ? `&cursor=${cursor}` : ""}`;
  const d = await kalshiGet(url);
  const events = d.events ?? [];
  total += events.length;
  for (const e of events) {
    const tk = (e.event_ticker ?? "").toUpperCase();
    const ti = (e.title ?? "").toUpperCase();
    if (tk.includes(needle) || ti.includes(needle)) hits.push({event_ticker: e.event_ticker, title: e.title, series_ticker: e.series_ticker});
  }
  cursor = d.cursor ?? "";
  if (!cursor) break;
}
console.log(`\nscanned ${total} events; hits for "${needle}": ${hits.length}`);
for (const h of hits.slice(0, 8)) console.log(" ", JSON.stringify(h));
