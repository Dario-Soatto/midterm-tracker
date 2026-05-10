import "server-only";
import { unstable_cache } from "next/cache";
import { getEvent, probDemFromEvent } from "@/lib/kalshi/client";
import { HOUSE_TICKERS, SENATE_TICKERS } from "@/lib/kalshi/catalog";
import {
  DISTRICT_PROB_DEM as MOCK_DISTRICTS,
  SENATE_PROB_DEM as MOCK_SENATE,
} from "@/lib/mock-data";

export type RacesSnapshot = {
  districtProbs: Record<string, number>;
  senateProbs: Record<string, number>;
  coverage: {
    /** number of districts where Kalshi returned a price */
    house: number;
    /** number of senate states where Kalshi returned a price */
    senate: number;
    /** epoch ms of the last successful Kalshi pull */
    fetchedAt: number;
  };
};

/**
 * Fetch every event we have a ticker for, in concurrency-limited batches.
 * Wrapped in `unstable_cache` keyed by version, so repeated calls within
 * `revalidate` return instantly. The 5-minute window matches Kalshi market
 * movement at this distance from the election (markets move slowly when the
 * vote is six months out).
 *
 * If a given event 404s or has no markets yet (e.g. KXSENATELA-26 — listed
 * but no live prices), it returns null and we silently skip it; the upstream
 * `getRaces` will fall back to mock for any race Kalshi didn't price.
 */
const fetchKalshi = unstable_cache(
  async (): Promise<{
    districtProbs: Record<string, number>;
    senateProbs: Record<string, number>;
    fetchedAt: number;
  }> => {
    type Task = {
      kind: "district" | "senate";
      key: string;
      ticker: string;
    };
    const tasks: Task[] = [];
    for (const [geoid, ticker] of Object.entries(HOUSE_TICKERS)) {
      tasks.push({ kind: "district", key: geoid, ticker });
    }
    for (const [abbr, ticker] of Object.entries(SENATE_TICKERS)) {
      tasks.push({ kind: "senate", key: abbr, ticker });
    }

    const districtProbs: Record<string, number> = {};
    const senateProbs: Record<string, number> = {};

    // Kalshi's basic-tier rate limit is strict (~10 req/sec). With 470 events
    // to fetch, we use a 2-worker pool, each pausing ~110 ms between
    // requests → ~18 req/sec aggregate. The retry helper handles the
    // occasional 429 with exponential backoff. ~470 × ~110 ms / 2 ≈ 26 s on
    // a cold cache; subsequent reads hit unstable_cache instantly.
    const CONCURRENCY = 2;
    const SPACING_MS = 110;
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const t = tasks[cursor++];
        const event = await getEvent(t.ticker);
        const p = probDemFromEvent(event);
        if (p !== null) {
          if (t.kind === "district") districtProbs[t.key] = p;
          else senateProbs[t.key] = p;
        }
        await new Promise((r) => setTimeout(r, SPACING_MS));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return { districtProbs, senateProbs, fetchedAt: Date.now() };
  },
  ["kalshi-races", "v1"],
  { revalidate: 300, tags: ["kalshi"] },
);

/**
 * Public accessor for the dashboard. Always returns a complete snapshot:
 * Kalshi prices win where present, mock data fills the rest. So the page
 * always renders even if Kalshi is down or a market hasn't opened yet.
 */
export async function getRaces(): Promise<RacesSnapshot> {
  let kalshi: {
    districtProbs: Record<string, number>;
    senateProbs: Record<string, number>;
    fetchedAt: number;
  };
  try {
    kalshi = await fetchKalshi();
  } catch (e) {
    console.error("[races] kalshi fetch failed, using mock only:", e);
    kalshi = { districtProbs: {}, senateProbs: {}, fetchedAt: 0 };
  }

  return {
    districtProbs: { ...MOCK_DISTRICTS, ...kalshi.districtProbs },
    senateProbs: { ...MOCK_SENATE, ...kalshi.senateProbs },
    coverage: {
      house: Object.keys(kalshi.districtProbs).length,
      senate: Object.keys(kalshi.senateProbs).length,
      fetchedAt: kalshi.fetchedAt,
    },
  };
}
