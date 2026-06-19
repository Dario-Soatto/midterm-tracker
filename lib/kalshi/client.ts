import "server-only";
import { kalshiFetchRetrying } from "./auth";

export type KalshiMarket = {
  ticker: string;
  yes_sub_title?: string;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  last_price_dollars: string;
  status: string;
  open_interest_fp?: string;
  custom_strike?: { Candidate?: string; Party?: string };
};

export type KalshiEvent = {
  event_ticker: string;
  title: string;
  sub_title?: string;
  category?: string;
  mutually_exclusive?: boolean;
  markets: KalshiMarket[];
};

/**
 * Fetch one event with its nested markets.
 * Returns null on 404 / network error so callers can fall back gracefully.
 */
export async function getEvent(ticker: string): Promise<KalshiEvent | null> {
  try {
    const data = await kalshiFetchRetrying<{ event: KalshiEvent }>(
      `/trade-api/v2/events/${encodeURIComponent(ticker)}?with_nested_markets=true`,
    );
    return data.event ?? null;
  } catch (e) {
    // surface for observability but don't break the page
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[kalshi] getEvent(${ticker}) failed:`, (e as Error).message);
    }
    return null;
  }
}

/**
 * Pick P(Democrat wins) out of a binary D-vs-R event.
 *
 * Sub-ticker conventions on Kalshi:
 *   - `-D` / `-R`             — standard (most markets)
 *   - `-DEM` / `-GOP`         — newer naming (KXHOUSENC11, etc.)
 *   - `-DOSB` etc.            — independent candidate (Nebraska 2026)
 *
 * We must NOT treat `-DOSB` as the D market. The strict regex
 * `/-(D|DEM)$/` matches `-D` / `-DEM` only. As a safety net we also
 * accept a `yes_sub_title` that explicitly says "Democratic" (catches
 * non-standard suffixes that still belong to the Dem candidate).
 *
 * Signal preference:
 *   1. last trade — the real market-clearing price. For low-volume safe
 *      seats (Chicago, deep-rural districts) the standing book is often
 *      bid=0.002 / ask=0.99 with last=0.97. The midpoint of that book is
 *      a meaningless 0.50; the last trade is the only honest signal.
 *   2. mid of a narrow standing book — only when there's been no trade
 *      AND bid/ask are close enough that the average is informative.
 *   3. single-sided fallback — bid if the ask is essentially "no one's
 *      selling" (≥0.99), ask if the bid is essentially "no one's buying"
 *      (≤0.01). Better than averaging two uncommitted orders.
 *   4. wide-spread mid — last resort.
 */
export function probDemFromEvent(event: KalshiEvent | null): number | null {
  return probsFromEvent(event)?.dem ?? null;
}

/**
 * Pull both P(D wins) and P(R wins) out of an event. With an independent
 * on the ballot (e.g. NE 2026 Senate, Osborn), `dem + rep < 1` and the
 * residual is P(indie wins). Callers must not assume `rep === 1 - dem`.
 */
export function probsFromEvent(
  event: KalshiEvent | null,
): { dem: number; rep: number } | null {
  if (!event || !event.markets || event.markets.length === 0) return null;
  const dem = sideProb(event, "D");
  const rep = sideProb(event, "R");
  if (dem === null || rep === null) return null;
  return { dem, rep };
}

const SIDE_TICKER = {
  D: /-(D|DEM)$/,
  R: /-(R|GOP)$/,
} as const;
const SIDE_TITLE = {
  D: /democratic/i,
  R: /republican/i,
} as const;

function sideProb(event: KalshiEvent, side: "D" | "R"): number | null {
  const market = event.markets.find(
    (m) =>
      SIDE_TICKER[side].test(m.ticker) ||
      SIDE_TITLE[side].test(m.yes_sub_title ?? ""),
  );
  if (!market) return null;

  const bid = parseFloat(market.yes_bid_dollars);
  const ask = parseFloat(market.yes_ask_dollars);
  const last = parseFloat(market.last_price_dollars);

  if (Number.isFinite(last) && last > 0) return clamp(last);

  const haveBid = Number.isFinite(bid) && bid > 0;
  const haveAsk = Number.isFinite(ask) && ask > 0;
  if (!haveBid && !haveAsk) return null;

  const NARROW_SPREAD = 0.2;
  if (haveBid && haveAsk && ask - bid <= NARROW_SPREAD) {
    return clamp((bid + ask) / 2);
  }
  if (haveBid && haveAsk && bid > 0.01 && ask >= 0.99) return clamp(bid);
  if (haveBid && haveAsk && ask < 0.99 && bid <= 0.01) return clamp(ask);
  if (haveBid && haveAsk) return clamp((bid + ask) / 2);
  return clamp(haveBid ? bid : ask);
}

const clamp = (x: number) => Math.max(0.001, Math.min(0.999, x));
