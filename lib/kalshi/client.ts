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
 * Most House and Senate 2026 events are mutually-exclusive 2-market events
 * with sub-tickers `<event>-D` / `<event>-R`. A handful of older markets
 * (e.g. KXHOUSENC11-26) use `-DEM` / `-GOP` instead — same shape, different
 * naming convention. We catch both via the `-D[A-Z]*$` pattern, plus a
 * `yes_sub_title` fallback for safety.
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
  if (!event || !event.markets || event.markets.length === 0) return null;
  const dMarket = event.markets.find(
    (m) =>
      /-D[A-Z]*$/.test(m.ticker) ||
      /democratic/i.test(m.yes_sub_title ?? ""),
  );
  if (!dMarket) return null;
  const bid = parseFloat(dMarket.yes_bid_dollars);
  const ask = parseFloat(dMarket.yes_ask_dollars);
  const last = parseFloat(dMarket.last_price_dollars);

  if (Number.isFinite(last) && last > 0) return clamp(last);

  const haveBid = Number.isFinite(bid) && bid > 0;
  const haveAsk = Number.isFinite(ask) && ask > 0;
  if (!haveBid && !haveAsk) return null;

  const NARROW_SPREAD = 0.2;
  if (haveBid && haveAsk && ask - bid <= NARROW_SPREAD) {
    return clamp((bid + ask) / 2);
  }
  // Wide spread, no trade — pick the side traders have actually committed to.
  if (haveBid && haveAsk && bid > 0.01 && ask >= 0.99) return clamp(bid);
  if (haveBid && haveAsk && ask < 0.99 && bid <= 0.01) return clamp(ask);
  if (haveBid && haveAsk) return clamp((bid + ask) / 2);
  return clamp(haveBid ? bid : ask);
}

const clamp = (x: number) => Math.max(0.001, Math.min(0.999, x));
