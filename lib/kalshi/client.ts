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
 * with sub-tickers `<event>-D` and `<event>-R`. We use the YES *mid-price*
 * of the -D market when both bid and ask are present (more stable than `last`,
 * which can be stale), and fall back to last_price_dollars otherwise.
 */
export function probDemFromEvent(event: KalshiEvent | null): number | null {
  if (!event || !event.markets || event.markets.length === 0) return null;
  const dMarket = event.markets.find((m) => /-D$/.test(m.ticker));
  if (!dMarket) return null;
  const bid = parseFloat(dMarket.yes_bid_dollars);
  const ask = parseFloat(dMarket.yes_ask_dollars);
  const last = parseFloat(dMarket.last_price_dollars);
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
    return clamp((bid + ask) / 2);
  }
  if (Number.isFinite(last) && last > 0) return clamp(last);
  return null;
}

const clamp = (x: number) => Math.max(0.001, Math.min(0.999, x));
