// Quick sanity check: probe individual Senate tickers + show candidate names
// so we can disentangle the SENATELA-26 / SENATEKY-26 mystery and confirm
// FL/OH special elections.

import crypto from "node:crypto";
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const apiKeyId = env.match(/KALSHI_API_KEY_ID=(.+)/)[1].trim();
const privateKey = env.match(/KALSHI_PRIVATE_KEY="([\s\S]+?)"/)[1];

async function get(p) {
  const ts = Date.now().toString();
  const path = p.split("?")[0];
  const sig = crypto
    .sign("sha256", Buffer.from(ts + "GET" + path), {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");
  const r = await fetch("https://api.elections.kalshi.com" + p, {
    headers: {
      "KALSHI-ACCESS-KEY": apiKeyId,
      "KALSHI-ACCESS-SIGNATURE": sig,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      Accept: "application/json",
    },
  });
  if (!r.ok) return { error: `${r.status}` };
  return r.json();
}

const tickers = [
  "SENATELA-26", // ticker says LA, title says Kentucky
  "SENATEKY-26", // does this exist?
  "KXSENATELA-26", // KX variant?
  "KXSENATEKY-26", // KX variant?
  "SENATEFLS-26", // Florida special
  "SENATEFL-26", // does FL regular exist?
  "SENATEOHS-26", // Ohio special
  "SENATEOH-26", // does OH regular exist?
  "SENATEAK-26", // labeled "(Party)"
];

for (const t of tickers) {
  const r = await get(`/trade-api/v2/events/${t}?with_nested_markets=true`);
  if (r.error || !r.event) {
    console.log(`${t.padEnd(20)} ❌ ${r.error || "no event"}`);
    continue;
  }
  const ev = r.event;
  console.log(
    `${t.padEnd(20)} ✓  "${ev.title}"  (${(ev.markets || []).length} mkts)`,
  );
  for (const m of (ev.markets || []).slice(0, 4)) {
    const sub = m.yes_sub_title || "?";
    console.log(
      `  ${m.ticker.padEnd(28)} last=${m.last_price_dollars}  ${sub}`,
    );
  }
}

// Also: search the catalog for any Louisiana-titled senate event
const cat = JSON.parse(
  fs.readFileSync("tmp/kalshi-catalog.json", "utf8"),
);
console.log("\nAll senate events with title containing 'Louisiana':");
for (const e of cat.events.senate) {
  if (/louisiana/i.test(e.title)) {
    console.log(`  ${e.event_ticker}: ${e.title}`);
  }
}
console.log("All senate events with title containing 'Florida' or 'Ohio':");
for (const e of cat.events.senate) {
  if (/florida|ohio/i.test(e.title)) {
    console.log(`  ${e.event_ticker}: ${e.title}`);
  }
}
