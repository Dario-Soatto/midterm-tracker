import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db/client";
import { prices } from "@/lib/db/schema";
import {
  DISTRICT_PROB_DEM as MOCK_DISTRICTS,
  SENATE_PROB_DEM as MOCK_SENATE,
} from "@/lib/mock-data";

export type RacesSnapshot = {
  /** P(Democrat wins) per race. */
  districtProbs: Record<string, number>;
  senateProbs: Record<string, number>;
  /** P(Republican wins) per race. With an independent on the ballot
   *  (e.g. NE 2026 senate, Osborn at ~34%), probDem + probRep < 1 and
   *  the residual is P(indie wins). */
  districtRepProbs: Record<string, number>;
  senateRepProbs: Record<string, number>;
  coverage: {
    /** Number of districts where the DB has a Kalshi-priced row. */
    house: number;
    /** Number of senate states where the DB has a Kalshi-priced row. */
    senate: number;
    /** Epoch ms of the most recent row written by the cron. */
    fetchedAt: number;
  };
};

type DbSnapshot = {
  districtProbs: Record<string, number>;
  senateProbs: Record<string, number>;
  districtRepProbs: Record<string, number>;
  senateRepProbs: Record<string, number>;
  fetchedAt: number;
};

/**
 * Read every priced race out of Postgres in one query. Cheap (~10 ms),
 * but we still wrap in `unstable_cache` with a 60-second window so a
 * burst of visitors doesn't fan out N round trips against the DB.
 *
 * The cron route refreshes the rows hourly; visitors only ever read.
 */
const fetchFromDb = unstable_cache(
  async (): Promise<DbSnapshot> => {
    const rows = await db.select().from(prices);
    const districtProbs: Record<string, number> = {};
    const senateProbs: Record<string, number> = {};
    const districtRepProbs: Record<string, number> = {};
    const senateRepProbs: Record<string, number> = {};
    let maxFetchedAt = 0;
    for (const r of rows) {
      const t =
        r.fetchedAt instanceof Date
          ? r.fetchedAt.getTime()
          : new Date(r.fetchedAt).getTime();
      if (t > maxFetchedAt) maxFetchedAt = t;
      // Rows written before the prob_rep column existed have a null there;
      // fall back to (1 - probDem) so the UI keeps rendering correctly
      // during the deploy → first-cron-run gap.
      const probRep = r.probRep ?? Math.max(0, Math.min(1, 1 - r.probDem));
      if (r.kind === "district") {
        districtProbs[r.raceKey] = r.probDem;
        districtRepProbs[r.raceKey] = probRep;
      } else if (r.kind === "senate") {
        senateProbs[r.raceKey] = r.probDem;
        senateRepProbs[r.raceKey] = probRep;
      }
    }
    return {
      districtProbs,
      senateProbs,
      districtRepProbs,
      senateRepProbs,
      fetchedAt: maxFetchedAt,
    };
  },
  ["races-from-db", "v2"],
  { revalidate: 60, tags: ["kalshi"] },
);

/**
 * Public accessor for the dashboard. Always returns a complete snapshot:
 * Kalshi prices win where present, mock data fills the rest. So a fresh
 * deploy renders sensibly even before the first cron run, and an empty
 * row (e.g. a market that hasn't traded yet) silently falls back to mock.
 */
export async function getRaces(): Promise<RacesSnapshot> {
  let snap: DbSnapshot;
  try {
    snap = await fetchFromDb();
  } catch (e) {
    console.error("[races] db read failed, using mock only:", e);
    snap = {
      districtProbs: {},
      senateProbs: {},
      districtRepProbs: {},
      senateRepProbs: {},
      fetchedAt: 0,
    };
  }

  // For mock data we don't track separate R probabilities — synthesize
  // them from `1 - probDem`. Real Kalshi rows override.
  const mockDistrictsRep = Object.fromEntries(
    Object.entries(MOCK_DISTRICTS).map(([k, v]) => [k, 1 - v]),
  );
  const mockSenateRep = Object.fromEntries(
    Object.entries(MOCK_SENATE).map(([k, v]) => [k, 1 - v]),
  );

  return {
    districtProbs: { ...MOCK_DISTRICTS, ...snap.districtProbs },
    senateProbs: { ...MOCK_SENATE, ...snap.senateProbs },
    districtRepProbs: { ...mockDistrictsRep, ...snap.districtRepProbs },
    senateRepProbs: { ...mockSenateRep, ...snap.senateRepProbs },
    coverage: {
      house: Object.keys(snap.districtProbs).length,
      senate: Object.keys(snap.senateProbs).length,
      fetchedAt: snap.fetchedAt,
    },
  };
}
