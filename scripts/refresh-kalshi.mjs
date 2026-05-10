// Manual local refresh — calls the cron route on localhost so you can
// repopulate the DB without waiting for Vercel Cron. Useful in dev.
//
// Requires `npm run dev` to be running on port 3001 and CRON_SECRET to be
// set in .env.local.
//
// Usage:
//   npm run kalshi:refresh

import { config } from "dotenv";
import path from "node:path";

config({ path: ".env.local" });

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error(
    "CRON_SECRET is not set in .env.local. Run `vercel env pull .env.local`.",
  );
  process.exit(1);
}

const port = process.env.MIDTERMS_DEV_PORT ?? "3001";
const url = `http://localhost:${port}/api/cron/refresh-kalshi`;

console.log(`POSTing to ${url} ...`);
const t0 = Date.now();
const res = await fetch(url, {
  method: "GET",
  headers: { Authorization: `Bearer ${secret}` },
});
const totalMs = Date.now() - t0;

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log(`HTTP ${res.status} · ${totalMs} ms`);
console.log(body);
process.exit(res.ok ? 0 : 1);
