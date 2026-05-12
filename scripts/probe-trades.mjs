// Does Kalshi's trades endpoint give finer history than candlesticks?
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

const market = process.argv[2] ?? "HOUSEAZ2-26-D";
const days = parseInt(process.argv[3] ?? "30", 10);
const end = Math.floor(Date.now() / 1000);
const start = end - days * 86400;

// Try trades endpoint (paginated)
let cursor = "";
let all = [];
for (let i = 0; i < 5; i++) {
  const url = `/trade-api/v2/markets/trades?ticker=${market}&min_ts=${start}&max_ts=${end}&limit=1000${cursor ? `&cursor=${cursor}` : ""}`;
  const data = await kalshiGet(url);
  const trades = data.trades ?? [];
  all = all.concat(trades);
  cursor = data.cursor ?? "";
  if (!cursor || trades.length === 0) break;
}
console.log(`trades over last ${days}d on ${market}: ${all.length}`);
if (all.length) {
  console.log("first:", JSON.stringify(all[all.length - 1]));
  console.log("last: ", JSON.stringify(all[0]));
}
