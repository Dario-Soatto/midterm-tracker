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

  // Most binary events use a `-D` sub-market for "Democrat wins", but a
  // handful (e.g. KXHOUSENC11-26) use the longer `-DEM` / `-GOP` naming.
  // Try the common convention first and fall back on 404 — same pattern
  // the cron uses via `probDemFromEvent`.
  const dMarketCandidates = [`${eventTicker}-D`, `${eventTicker}-DEM`];

  const fetchCandles = (market: string, startTs: number, endTs: number, period: number) =>
    kalshiFetchRetrying<{ candlesticks: Candle[] }>(
      `/trade-api/v2/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(market)}/candlesticks?start_ts=${startTs}&end_ts=${endTs}&period_interval=${period}`,
    );

  try {
    let data: { candlesticks: Candle[] } | null = null;
    let dMarket: string | null = null;
    let lastErr: Error | null = null;
    // First resolve which sub-ticker (`-D` vs `-DEM`) actually exists for
    // this event, using hourly candles for the requested window.
    for (const candidate of dMarketCandidates) {
      try {
        data = await fetchCandles(candidate, start, end, PERIOD_MIN);
        dMarket = candidate;
        break;
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        lastErr = e as Error;
        if (status !== 404) throw e;
        // 404 → try the next sub-ticker shape
      }
    }
    if (!data || !dMarket) {
      throw lastErr ?? new Error(`No D-side sub-market found for ${eventTicker}`);
    }

    // Low-volume markets (e.g. KXHOUSERACE-TX02-26) don't get any hourly
    // candles emitted by Kalshi at all — only daily ones. Hourly returns
    // an empty array; we then retry at daily granularity inside the
    // requested window, then widen the lookback up to a year if the
    // requested window has no daily candles either. The carry-forward
    // pass downstream fills in the visual line.
    if (data.candlesticks.length === 0) {
      try {
        const daily = await fetchCandles(dMarket, start, end, PERIOD_MIN_DAILY);
        if (daily.candlesticks.length > 0) data = daily;
      } catch {
        /* keep empty data; try wide lookback below */
      }
    }
    if (data.candlesticks.length === 0) {
      try {
        const wide = await fetchCandles(
          dMarket,
          end - WIDE_LOOKBACK_DAYS * 86400,
          end,
          PERIOD_MIN_DAILY,
        );
        if (wide.candlesticks.length > 0) data = wide;
      } catch {
        /* leave data empty; respond with points: [] */
      }
    }

    const raw = data.candlesticks
      .map((c) => {
        // Match what Kalshi.com itself plots: the most recent YES *trade*
        // price as of the candle's end. `close_dollars` is set when the
        // candle had volume; `previous_dollars` carries forward the last
        // trade from earlier periods. Only fall back to the bid/ask
        // midpoint if the market has never traded — otherwise the spread
        // mid drifts independently of the trade price and the chart
        // disagrees visibly with Kalshi's.
        const close = parseFloat(c.price?.close_dollars ?? "");
        const prev = parseFloat(c.price?.previous_dollars ?? "");
        const bid = parseFloat(c.yes_bid?.close_dollars ?? "");
        const ask = parseFloat(c.yes_ask?.close_dollars ?? "");
        let p: number | null = null;
        if (Number.isFinite(close) && close > 0) {
          p = close;
        } else if (Number.isFinite(prev) && prev > 0) {
          p = prev;
        } else if (
          Number.isFinite(bid) &&
          Number.isFinite(ask) &&
          bid > 0 &&
          ask > 0
        ) {
          p = (bid + ask) / 2;
        }
        return p === null ? null : { ts: c.end_period_ts, p };
      })
      .filter((pt): pt is { ts: number; p: number } => pt !== null)
      .sort((a, b) => a.ts - b.ts);

    // Kalshi only emits a candle when the market actually moves (volume, bid,
    // or ask changes). For low-volume races (e.g. HOUSEAZ2-26) that yields
    // 3-ish candles over 7 days even though the standing bid/ask is well-
    // defined the whole time — the chart then reads as broken. Resample
    // onto a regular hourly grid via carry-forward so the line stays
    // continuous all the way to `end`. Kalshi.com's own chart does the
    // same thing.
    const STEP_SEC = PERIOD_MIN * 60;
    const points: { ts: number; p: number }[] = [];
    if (raw.length > 0) {
      // Clamp the grid to the requested window. raw[0].ts may sit before
      // `start` when we widened the lookback; in that case we still seed
      // lastP from the latest candle at-or-before `start` so the line
      // begins at the correct value.
      const gridStart = Math.max(raw[0].ts, start);
      let idx = 0;
      let lastP = raw[0].p;
      while (idx + 1 < raw.length && raw[idx + 1].ts <= gridStart) {
        idx++;
        lastP = raw[idx].p;
      }
      for (let ts = gridStart; ts <= end; ts += STEP_SEC) {
        while (idx + 1 < raw.length && raw[idx + 1].ts <= ts) {
          idx++;
          lastP = raw[idx].p;
        }
        points.push({ ts, p: lastP });
      }
      // Pin the most recent real candle (only if it lands in-window) in
      // case it falls between grid steps.
      const lastReal = raw[raw.length - 1];
      if (
        lastReal.ts >= gridStart &&
        lastReal.ts <= end &&
        (points.length === 0 || points[points.length - 1].ts < lastReal.ts)
      ) {
        points.push(lastReal);
      }
    }

    return NextResponse.json({
      eventTicker,
      series,
      market: dMarket,
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
