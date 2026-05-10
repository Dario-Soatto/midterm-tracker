import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db/client";
import { prices } from "@/lib/db/schema";
import {
  DISTRICT_PROB_DEM as MOCK_DISTRICTS,
  SENATE_PROB_DEM as MOCK_SENATE,
} from "@/lib/mock-data";

export type RacesSnapshot = {
  districtProbs: Record<string, number>;
  senateProbs: Record<string, number>;
  coverage: {
    /** Number of districts where the DB has a Kalshi-priced row. */
    house: number;
    /** Number of senate states where the DB has a Kalshi-priced row. */
    senate: number;
    /** Epoch ms of the most recent row written by the cron. */
    fetchedAt: number;
  };
};

/**
 * Read every priced race out of Postgres in one query. Cheap (~10 ms),
 * but we still wrap in `unstable_cache` with a 60-second window so a
 * burst of visitors doesn't fan out N round trips against the DB.
 *
 * The cron route refreshes the rows hourly; visitors only ever read.
 */
const fetchFromDb = unstable_cache(
  async () => {
    const rows = await db.select().from(prices);
    const districtProbs: Record<string, number> = {};
    const senateProbs: Record<string, number> = {};
    let maxFetchedAt = 0;
    for (const r of rows) {
      const t = r.fetchedAt instanceof Date
        ? r.fetchedAt.getTime()
        : new Date(r.fetchedAt).getTime();
      if (t > maxFetchedAt) maxFetchedAt = t;
      if (r.kind === "district") districtProbs[r.raceKey] = r.probDem;
      else if (r.kind === "senate") senateProbs[r.raceKey] = r.probDem;
    }
    return { districtProbs, senateProbs, fetchedAt: maxFetchedAt };
  },
  ["races-from-db", "v1"],
  { revalidate: 60, tags: ["kalshi"] },
);

/**
 * Public accessor for the dashboard. Always returns a complete snapshot:
 * Kalshi prices win where present, mock data fills the rest. So a fresh
 * deploy renders sensibly even before the first cron run, and an empty
 * row (e.g. a market that hasn't traded yet) silently falls back to mock.
 */
export async function getRaces(): Promise<RacesSnapshot> {
  let snap: {
    districtProbs: Record<string, number>;
    senateProbs: Record<string, number>;
    fetchedAt: number;
  };
  try {
    snap = await fetchFromDb();
  } catch (e) {
    console.error("[races] db read failed, using mock only:", e);
    snap = { districtProbs: {}, senateProbs: {}, fetchedAt: 0 };
  }

  return {
    districtProbs: { ...MOCK_DISTRICTS, ...snap.districtProbs },
    senateProbs: { ...MOCK_SENATE, ...snap.senateProbs },
    coverage: {
      house: Object.keys(snap.districtProbs).length,
      senate: Object.keys(snap.senateProbs).length,
      fetchedAt: snap.fetchedAt,
    },
  };
}
