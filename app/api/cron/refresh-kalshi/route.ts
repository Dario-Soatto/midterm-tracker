import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { prices } from "@/lib/db/schema";
import { fetchAllRaceSnapshots } from "@/lib/kalshi/snapshot";

// Vercel Hobby = 60s default; our throttled fetch needs ~25-35s. Cron runs
// in the same serverless function class, so this applies to both Vercel-Cron
// invocations and manual `curl` triggers.
export const maxDuration = 60;

// We deliberately bypass the route-level fetch cache here — this endpoint
// IS the freshness boundary; we want every invocation to actually hit Kalshi.
export const dynamic = "force-dynamic";

/**
 * Cron handler: pulls a fresh price snapshot for every race in the catalog
 * and UPSERTs into the `prices` table. Vercel Cron sends a request with
 * `Authorization: Bearer ${CRON_SECRET}`; we reject anything else.
 *
 * Manual local trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/refresh-kalshi
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  let snapshots;
  try {
    snapshots = await fetchAllRaceSnapshots();
  } catch (e) {
    console.error("[cron] kalshi fetch failed:", e);
    return NextResponse.json(
      { error: "kalshi fetch failed", message: (e as Error).message },
      { status: 502 },
    );
  }
  const fetchMs = Date.now() - t0;

  if (snapshots.length === 0) {
    return NextResponse.json(
      { error: "no snapshots returned" },
      { status: 502 },
    );
  }

  const fetchedAt = new Date();
  // Single batched UPSERT. ON CONFLICT (event_ticker) DO UPDATE so we
  // overwrite the prior row in place — no history retained by design.
  await db
    .insert(prices)
    .values(
      snapshots.map((s) => ({
        eventTicker: s.ticker,
        kind: s.kind,
        raceKey: s.raceKey,
        probDem: s.probDem,
        probRep: s.probRep,
        fetchedAt,
      })),
    )
    .onConflictDoUpdate({
      target: prices.eventTicker,
      set: {
        kind: sql`excluded.kind`,
        raceKey: sql`excluded.race_key`,
        probDem: sql`excluded.prob_dem`,
        probRep: sql`excluded.prob_rep`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });

  // Bust the page-side caches so visitors immediately see fresh numbers:
  //   revalidateTag("kalshi", "max") — flushes the unstable_cache data layer
  //   revalidatePath("/")            — flushes the cached HTML for the
  //                                   homepage, so the static-rendered page
  //                                   re-renders on next request.
  revalidateTag("kalshi", "max");
  revalidatePath("/");

  return NextResponse.json({
    ok: true,
    fetched: snapshots.length,
    fetchedAt: fetchedAt.toISOString(),
    timings: {
      fetchMs,
      totalMs: Date.now() - t0,
    },
  });
}
