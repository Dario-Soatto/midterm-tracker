// Find Kalshi events/markets matching a substring (e.g. "NC11", "NC-11").
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
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const needle = (process.argv[2] ?? "NC11").toUpperCase();

// Try markets listing with the ticker pattern as a search prefix
let cursor = "";
let matches = [];
for (let i = 0; i < 20; i++) {
  const url = `/trade-api/v2/markets?limit=1000${cursor ? `&cursor=${cursor}` : ""}`;
  const d = await kalshiGet(url);
  const markets = d.markets ?? [];
  for (const m of markets) {
    const t = (m.ticker ?? "").toUpperCase();
    const e = (m.event_ticker ?? "").toUpperCase();
    if (t.includes(needle) || e.includes(needle)) {
      matches.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        title: m.title,
        subtitle: m.subtitle,
        status: m.status,
      });
    }
  }
  cursor = d.cursor ?? "";
  if (!cursor) break;
}

console.log(`matches for "${needle}": ${matches.length}`);
for (const m of matches.slice(0, 12)) {
  console.log(" ", JSON.stringify(m));
}
