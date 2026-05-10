import "server-only";
import crypto from "node:crypto";

const KALSHI_BASE = "https://api.elections.kalshi.com";

function getCreds() {
  const id = process.env.KALSHI_API_KEY_ID;
  const key = process.env.KALSHI_PRIVATE_KEY;
  if (!id || !key) {
    throw new Error(
      "Missing KALSHI_API_KEY_ID or KALSHI_PRIVATE_KEY in env (.env.local)",
    );
  }
  return { id, key };
}

/**
 * Sign + send a Kalshi API request.
 *
 * Auth:
 *   • RSA-PSS sign(timestamp + METHOD + path) with the account private key
 *   • Send as KALSHI-ACCESS-{KEY,SIGNATURE,TIMESTAMP} headers
 * The signature path is the URL pathname WITHOUT the query string.
 */
export async function kalshiFetch<T>(
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const { id, key } = getCreds();
  const ts = Date.now().toString();
  const method = (init?.method ?? "GET").toUpperCase();
  const pathOnly = pathname.split("?")[0];

  const sig = crypto
    .sign("sha256", Buffer.from(ts + method + pathOnly), {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");

  const res = await fetch(KALSHI_BASE + pathname, {
    ...init,
    headers: {
      ...init?.headers,
      "KALSHI-ACCESS-KEY": id,
      "KALSHI-ACCESS-SIGNATURE": sig,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(
      `Kalshi ${method} ${pathname} → ${res.status}: ${body.slice(0, 300)}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Promise-based delay. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * kalshiFetch with exponential-backoff retry on 429s.
 * Use this for endpoints called in tight batches (where the basic-tier rate
 * limit kicks in fast).
 */
export async function kalshiFetchRetrying<T>(
  pathname: string,
  init?: RequestInit,
  attempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await kalshiFetch<T>(pathname, init);
    } catch (e) {
      lastErr = e;
      const status = (e as Error & { status?: number }).status;
      if (status !== 429 && status !== 503) throw e;
      // exp backoff with jitter: 250 / 500 / 1000 / 2000 / 4000 ms (+0–250 jitter)
      const wait = 250 * Math.pow(2, i) + Math.random() * 250;
      await sleep(wait);
    }
  }
  throw lastErr;
}
