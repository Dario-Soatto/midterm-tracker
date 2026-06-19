import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per Kalshi event we track. Overwritten on each cron poll
 * (we don't keep history — see chat decision: candlesticks are per-ticker
 * so backfilling history would be 470 extra API calls per render).
 *
 *   event_ticker   primary key — Kalshi's identifier (e.g. KXHOUSERACE-TX23-26)
 *   kind           "district" | "senate"  — how the upstream UI keys this race
 *   race_key       GEOID for districts (e.g. "4823"), state abbr for senate ("TX")
 *   prob_dem       latest P(Democrat wins), in [0, 1]
 *   prob_rep       latest P(Republican wins), in [0, 1]. Nullable for
 *                  backward compat: rows written before the column existed
 *                  fall back to `1 - prob_dem` at read time. With an
 *                  independent on the ballot (e.g. Nebraska 2026, Osborn),
 *                  prob_dem + prob_rep < 1; the residual is P(indie wins).
 *   fetched_at     when this row was written by the cron
 */
export const prices = pgTable("prices", {
  eventTicker: text("event_ticker").primaryKey(),
  kind: text("kind").notNull(),
  raceKey: text("race_key").notNull(),
  probDem: real("prob_dem").notNull(),
  probRep: real("prob_rep"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export type PriceRow = typeof prices.$inferSelect;
export type PriceInsert = typeof prices.$inferInsert;
