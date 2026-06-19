import { NextResponse } from "next/server";
import { kalshiFetchRetrying } from "@/lib/kalshi/auth";

// Whitelist of window sizes the UI exposes; anything else falls back to 30d.
const ALLOWED_DAYS = new Set([7, 30, 90]);
const DEFAULT_DAYS = 30;

/** Candle resolution in minutes (60 = hourly). */
const PERIOD_MIN = 60;
/** Fallback granularity when Kalshi has no hourly candles for the market. */
const PERIOD_MIN_DAILY = 1440;
/** When even the daily fetch comes back empty within the requested window,
 *  widen the lookback this far so we can carry-forward from older history. */
const WIDE_LOOKBACK_DAYS = 365;

/**
 * Strip the trailing `-YY[suffix]` (e.g. `-26`, `-26NOV`) off an event ticker
 * to recover the series ticker. Special-case the comprehensive House series
 * `KXHOUSERACE` which holds every per-district event.
 */
function seriesFromEvent(eventTicker: string): string {
  if (eventTicker.startsWith("KXHOUSERACE-")) return "KXHOUSERACE";
  return eventTicker.replace(/-\d+[A-Z0-9]*$/, "");
}

type Candle = {
  end_period_ts: number;
  price?: { close_dollars?: string; previous_dollars?: string };
  yes_bid?: { close_dollars?: string };
  yes_ask?: { close_dollars?: string };
};

type RawPoint = { ts: number; p: number };

export async function GET(
  req: Request,
  context: { params: Promise<{ event: string }> },
) {
  const { event } = await context.params;
  const eventTicker = decodeURIComponent(event);
  const series = seriesFromEvent(eventTicker);

  const url = new URL(req.url);
  const requested = parseInt(url.searchParams.get("days") ?? "", 10);
  const days = ALLOWED_DAYS.has(requested) ? requested : DEFAULT_DAYS;

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;

  // Most binary events use `-D` / `-R` sub-markets; the newer naming
  // convention (e.g. KXHOUSENC11-26-DEM / -GOP) is tried as a fallback.
  // We must NOT match `-DOSB` (Nebraska's Osborn) here — that's an
  // independent and rolls into the implicit residual on the chart.
  const dCandidates = [`${eventTicker}-D`, `${eventTicker}-DEM`];
  const rCandidates = [`${eventTicker}-R`, `${eventTicker}-GOP`];

  const fetchCandles = (
    market: string,
    startTs: number,
    endTs: number,
    period: number,
  ) =>
    kalshiFetchRetrying<{ candlesticks: Candle[] }>(
      `/trade-api/v2/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(market)}/candlesticks?start_ts=${startTs}&end_ts=${endTs}&period_interval=${period}`,
    );

  // For each side (D / R), resolve which sub-ticker shape Kalshi actually
  // has, then pull candles with the same ladder we use elsewhere:
  // hourly-in-window → daily-in-window → daily-365-day-lookback.
  const fetchSideRaw = async (
    candidates: string[],
  ): Promise<{ market: string; raw: RawPoint[] } | null> => {
    let data: { candlesticks: Candle[] } | null = null;
    let market: string | null = null;
    let lastErr: Error | null = null;
    for (const candidate of candidates) {
      try {
        data = await fetchCandles(candidate, start, end, PERIOD_MIN);
        market = candidate;
        break;
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        lastErr = e as Error;
        if (status !== 404) throw e;
      }
    }
    if (!data || !market) {
      if (lastErr) throw lastErr;
      return null;
    }
    if (data.candlesticks.length === 0) {
      try {
        const daily = await fetchCandles(market, start, end, PERIOD_MIN_DAILY);
        if (daily.candlesticks.length > 0) data = daily;
      } catch {
        /* fall through to wide lookback */
      }
    }
    if (data.candlesticks.length === 0) {
      try {
        const wide = await fetchCandles(
          market,
          end - WIDE_LOOKBACK_DAYS * 86400,
          end,
          PERIOD_MIN_DAILY,
        );
        if (wide.candlesticks.length > 0) data = wide;
      } catch {
        /* leave data empty */
      }
    }
    return { market, raw: parseCandles(data.candlesticks) };
  };

  try {
    const [dSide, rSide] = await Promise.all([
      fetchSideRaw(dCandidates),
      fetchSideRaw(rCandidates),
    ]);
    if (!dSide) throw new Error(`No D-side sub-market for ${eventTicker}`);
    if (!rSide) throw new Error(`No R-side sub-market for ${eventTicker}`);

    const dGrid = buildGrid(dSide.raw, start, end);
    const rGrid = buildGrid(rSide.raw, start, end);
    const points = mergeGrids(dGrid, rGrid);

    return NextResponse.json({
      eventTicker,
      series,
      dMarket: dSide.market,
      rMarket: rSide.market,
      days,
      points,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, eventTicker },
      { status: 502 },
    );
  }
}

/**
 * Match what Kalshi.com itself plots: the most recent YES *trade* price
 * as of the candle's end. `close_dollars` is set when the candle had
 * volume; `previous_dollars` carries forward the last trade from earlier
 * periods. Only fall back to the bid/ask midpoint if the market has
 * never traded — otherwise the spread mid drifts independently of the
 * trade price and the chart disagrees visibly with Kalshi's.
 */
function parseCandles(candles: Candle[]): RawPoint[] {
  return candles
    .map((c) => {
      const close = parseFloat(c.price?.close_dollars ?? "");
      const prev = parseFloat(c.price?.previous_dollars ?? "");
      const bid = parseFloat(c.yes_bid?.close_dollars ?? "");
      const ask = parseFloat(c.yes_ask?.close_dollars ?? "");
      let p: number | null = null;
      if (Number.isFinite(close) && close > 0) p = close;
      else if (Number.isFinite(prev) && prev > 0) p = prev;
      else if (
        Number.isFinite(bid) &&
        Number.isFinite(ask) &&
        bid > 0 &&
        ask > 0
      ) {
        p = (bid + ask) / 2;
      }
      return p === null ? null : { ts: c.end_period_ts, p };
    })
    .filter((pt): pt is RawPoint => pt !== null)
    .sort((a, b) => a.ts - b.ts);
}

const STEP_SEC = PERIOD_MIN * 60;

/**
 * Kalshi only emits a candle when the market moves. For low-volume races
 * that yields ~3 candles over 7 days even though the standing bid/ask
 * has been well-defined the whole time. Resample onto a regular hourly
 * grid via carry-forward so the chart line stays continuous up to `end`,
 * mirroring how Kalshi.com itself draws these charts.
 */
function buildGrid(raw: RawPoint[], start: number, end: number): RawPoint[] {
  if (raw.length === 0) return [];
  const gridStart = Math.max(raw[0].ts, start);
  let idx = 0;
  let lastP = raw[0].p;
  while (idx + 1 < raw.length && raw[idx + 1].ts <= gridStart) {
    idx++;
    lastP = raw[idx].p;
  }
  const out: RawPoint[] = [];
  for (let ts = gridStart; ts <= end; ts += STEP_SEC) {
    while (idx + 1 < raw.length && raw[idx + 1].ts <= ts) {
      idx++;
      lastP = raw[idx].p;
    }
    out.push({ ts, p: lastP });
  }
  const lastReal = raw[raw.length - 1];
  if (
    lastReal.ts >= gridStart &&
    lastReal.ts <= end &&
    (out.length === 0 || out[out.length - 1].ts < lastReal.ts)
  ) {
    out.push(lastReal);
  }
  return out;
}

/**
 * Inner-join the D and R grids on `ts`. Since both grids share the same
 * step but may have started at different points (each side seeds from
 * its own raw[0].ts), the intersection drops the leading values where
 * only one side has data — keeps the two lines synchronized.
 *
 * We also echo `p` (= pD) on every point so any client still running an
 * older bundle from before the multi-line chart shipped reads its line
 * correctly — without it those clients render NaN for every coordinate
 * during the Vercel rollout window.
 */
function mergeGrids(
  dGrid: RawPoint[],
  rGrid: RawPoint[],
): { ts: number; pD: number; pR: number; p: number }[] {
  const out: { ts: number; pD: number; pR: number; p: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < dGrid.length && j < rGrid.length) {
    if (dGrid[i].ts === rGrid[j].ts) {
      out.push({
        ts: dGrid[i].ts,
        pD: dGrid[i].p,
        pR: rGrid[j].p,
        p: dGrid[i].p,
      });
      i++;
      j++;
    } else if (dGrid[i].ts < rGrid[j].ts) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}
