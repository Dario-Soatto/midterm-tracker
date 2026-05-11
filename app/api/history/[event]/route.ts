import { NextResponse } from "next/server";
import { kalshiFetchRetrying } from "@/lib/kalshi/auth";

// Whitelist of window sizes the UI exposes; anything else falls back to 30d.
const ALLOWED_DAYS = new Set([7, 30, 90]);
const DEFAULT_DAYS = 30;

/** Candle resolution in minutes (60 = hourly). */
const PERIOD_MIN = 60;

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
  price?: { previous_dollars?: string };
  yes_bid?: { close_dollars?: string };
  yes_ask?: { close_dollars?: string };
};

export async function GET(
  req: Request,
  context: { params: Promise<{ event: string }> },
) {
  const { event } = await context.params;
  const eventTicker = decodeURIComponent(event);
  // Every binary event in our catalog has a `<event>-D` sub-market; that's
  // the one that quotes P(Democrat wins).
  const dMarket = `${eventTicker}-D`;
  const series = seriesFromEvent(eventTicker);

  const url = new URL(req.url);
  const requested = parseInt(url.searchParams.get("days") ?? "", 10);
  const days = ALLOWED_DAYS.has(requested) ? requested : DEFAULT_DAYS;

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;

  try {
    const data = await kalshiFetchRetrying<{ candlesticks: Candle[] }>(
      `/trade-api/v2/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(dMarket)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${PERIOD_MIN}`,
    );

    const points = data.candlesticks
      .map((c) => {
        // Prefer YES bid/ask mid; fall back to the last-trade price if the
        // book was one-sided in that candle.
        const bid = parseFloat(c.yes_bid?.close_dollars ?? "");
        const ask = parseFloat(c.yes_ask?.close_dollars ?? "");
        const prev = parseFloat(c.price?.previous_dollars ?? "");
        let p: number | null = null;
        if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
          p = (bid + ask) / 2;
        } else if (Number.isFinite(prev) && prev > 0) {
          p = prev;
        }
        return p === null ? null : { ts: c.end_period_ts, p };
      })
      .filter((pt): pt is { ts: number; p: number } => pt !== null);

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
