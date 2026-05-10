import "server-only";
import { getEvent, probDemFromEvent } from "./client";
import { HOUSE_TICKERS, SENATE_TICKERS } from "./catalog";

export type RaceSnapshot = {
  /** Kalshi event ticker (e.g. KXHOUSERACE-TX23-26 / SENATETX-26). */
  ticker: string;
  /** "district" or "senate" — used by the UI keying. */
  kind: "district" | "senate";
  /** GEOID for districts, state abbr for senate. */
  raceKey: string;
  /** P(Democrat wins), in [0, 1]. */
  probDem: number;
};

/**
 * Pull a current snapshot for every race we have a Kalshi ticker for.
 *
 * Throttled to ~18 req/sec (2 workers × 110 ms spacing) to stay under Kalshi's
 * basic-tier rate limit; the retry helper inside `getEvent` handles the rare
 * 429 with exponential backoff. ~470 events ≈ 26 s end-to-end.
 *
 * Used by:
 *   • the cron route (writes results to Postgres)
 *   • a manual local refresh script
 */
export async function fetchAllRaceSnapshots(): Promise<RaceSnapshot[]> {
  type Task = { kind: "district" | "senate"; key: string; ticker: string };
  const tasks: Task[] = [];
  for (const [geoid, ticker] of Object.entries(HOUSE_TICKERS)) {
    tasks.push({ kind: "district", key: geoid, ticker });
  }
  for (const [abbr, ticker] of Object.entries(SENATE_TICKERS)) {
    tasks.push({ kind: "senate", key: abbr, ticker });
  }

  const out: RaceSnapshot[] = [];
  const CONCURRENCY = 2;
  const SPACING_MS = 110;
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const t = tasks[cursor++];
      const event = await getEvent(t.ticker);
      const p = probDemFromEvent(event);
      if (p !== null) {
        out.push({ ticker: t.ticker, kind: t.kind, raceKey: t.key, probDem: p });
      }
      await new Promise((r) => setTimeout(r, SPACING_MS));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}
