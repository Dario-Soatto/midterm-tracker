import Dashboard from "./Dashboard";
import { getRaces } from "@/lib/data/races";

// Re-render the page at most every 60s so visitors see fresh DB rows.
// The cron route also calls revalidatePath("/") for an immediate flush.
export const revalidate = 60;

export default async function HomePage() {
  const races = await getRaces();
  const fetchedLabel =
    races.coverage.fetchedAt > 0
      ? new Date(races.coverage.fetchedAt).toISOString().slice(0, 16) + "Z"
      : "fallback (mock)";

  return (
    <div className="mx-auto max-w-6xl px-8">
      <section className="grid lg:grid-cols-[5fr_4fr] gap-10 py-16">
        <div>
          <h1 className="font-serif text-5xl leading-[1.05] text-[var(--color-ink)] tracking-tight">
            The 2026 midterms in{" "}
            <span className="font-serif italic text-[var(--color-dem)]">
              probability
            </span>
          </h1>
          <p className="mt-6 text-sm leading-relaxed text-[var(--color-ink-soft)] max-w-md">
            Live prediction-market odds for every U.S. House district and
            Senate race, sourced from Kalshi and aggregated into chamber-level
            seat distributions. Click any district or state to see the
            underlying race.
          </p>
        </div>
        <div className="flex flex-col justify-end gap-4">
          <div className="grid grid-cols-2 gap-x-8 text-xs lg:justify-self-end">
            <Stat n="435" label="house seats" />
            <Stat n="35" label="senate seats" />
          </div>
          <p className="text-[10px] tracking-wider text-[var(--color-ink-mute)] lg:text-right">
            kalshi: {races.coverage.house}/435 house · {races.coverage.senate}
            /35 senate · {fetchedLabel}
          </p>
        </div>
      </section>

      <Dashboard
        districtProbs={races.districtProbs}
        senateProbs={races.senateProbs}
      />
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span className="font-serif text-xl text-[var(--color-ink)]">{n}</span>
      <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)] uppercase">
        {label}
      </span>
    </div>
  );
}
