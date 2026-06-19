"use client";

import type { Boundaries } from "@/lib/boundaries";
import { STATES_BY_FIPS, SENATE_2026_STATES } from "@/lib/states";
import {
  PARTY_LABEL,
  leadingFromProbs,
  partyInk,
  tintByOdds,
} from "@/lib/colors";
import { HOUSE_TICKERS, SENATE_TICKERS } from "@/lib/kalshi/catalog";
import { kalshiEventUrl } from "@/lib/kalshi/url";
import HistoryChart from "./HistoryChart";

type View = "house" | "senate";

type Selection =
  | { kind: "district"; geoid: string }
  | { kind: "state"; fips: string }
  | null;

type Props = {
  view: View;
  selected: Selection;
  boundaries: Boundaries;
  districtProbs: Record<string, number>;
  senateProbs: Record<string, number>;
  districtRepProbs: Record<string, number>;
  senateRepProbs: Record<string, number>;
  onClose: () => void;
};

export default function DetailPanel({
  selected,
  boundaries,
  districtProbs,
  senateProbs,
  districtRepProbs,
  senateRepProbs,
  onClose,
}: Props) {
  if (!selected) return null;

  if (selected.kind === "district") {
    const d = boundaries.districts.find((x) => x.geoid === selected.geoid);
    if (!d) return null;
    const meta = STATES_BY_FIPS[d.statefips];
    const p = districtProbs[d.geoid];
    const pR = districtRepProbs[d.geoid];
    const ticker = HOUSE_TICKERS[d.geoid];

    return (
      <div className="px-6 py-5">
        <PanelHeader title={d.name} subtitle={meta?.name ?? ""} onClose={onClose} />
        <ProbBar probDem={p} probRep={pR} />
        {ticker && <HistoryChart eventTicker={ticker} />}
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]">
              GEOID
            </div>
            <div className="font-mono">{d.geoid}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]">
              type
            </div>
            <div>U.S. House — {meta?.abbr} CD-{Number(d.cd) || "AL"}</div>
          </div>
        </div>
        {ticker && <KalshiLink ticker={ticker} />}
      </div>
    );
  }

  // state selection
  const meta = STATES_BY_FIPS[selected.fips];
  if (!meta) return null;

  const eligible = SENATE_2026_STATES.has(meta.abbr);
  const senateDem = eligible ? senateProbs[meta.abbr] : undefined;
  const senateRep = eligible ? senateRepProbs[meta.abbr] : undefined;
  const senateTicker = SENATE_TICKERS[meta.abbr];
  const hasSenate = eligible && !!senateTicker;

  return (
    <div className="px-6 py-5">
      <PanelHeader title={meta.name} subtitle={meta.abbr} onClose={onClose} />

      <section className="mt-2">
        <RaceRow
          label="senate · 2026"
          probDem={senateDem}
          probRep={senateRep}
          fallback={eligible ? undefined : "no 2026 senate election"}
        />
        {hasSenate && <HistoryChart eventTicker={senateTicker} />}
      </section>

      {hasSenate && <KalshiLink ticker={senateTicker} />}
    </div>
  );
}

function KalshiLink({ ticker }: { ticker: string }) {
  return (
    <a
      href={kalshiEventUrl(ticker)}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-5 flex items-center justify-between gap-3 border border-[var(--color-rule)] hover:border-[var(--color-ink)] px-3 py-2 text-[10px] tracking-widest uppercase text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] transition-colors group"
    >
      <span className="flex items-baseline gap-2">
        <span>view on kalshi</span>
        <span className="font-mono text-[var(--color-ink-mute)] normal-case tracking-normal">
          {ticker}
        </span>
      </span>
      <span aria-hidden className="text-base leading-none translate-y-[-1px] group-hover:translate-x-0.5 transition-transform">
        →
      </span>
    </a>
  );
}

function PanelHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 mb-4">
      <div>
        <div className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]">
          {subtitle}
        </div>
        <h3 className="font-serif text-2xl mt-0.5">{title}</h3>
      </div>
      <button
        onClick={onClose}
        className="text-[10px] tracking-widest uppercase text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] border border-[var(--color-rule)] px-2 py-1"
      >
        close
      </button>
    </div>
  );
}

function RaceRow({
  label,
  probDem,
  probRep,
  fallback,
}: {
  label: string;
  probDem: number | undefined;
  probRep: number | undefined;
  fallback?: string;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)] mb-1.5">
        {label}
      </div>
      {fallback ? (
        <div className="text-xs text-[var(--color-ink-mute)] italic">
          {fallback}
        </div>
      ) : probDem === undefined ? (
        <div className="text-xs text-[var(--color-ink-mute)]">no data</div>
      ) : (
        <ProbBar probDem={probDem} probRep={probRep} />
      )}
    </div>
  );
}

/**
 * Two-segment bar showing P(D) and P(R) as raw market probabilities. With
 * an independent on the ballot (NE 2026, Osborn) the two segments don't
 * fill the whole bar — the gap is P(indie wins), rendered in a neutral
 * tone so it's visible without giving independents their own labeled slot.
 */
function ProbBar({
  probDem,
  probRep,
}: {
  probDem: number | undefined;
  probRep: number | undefined;
}) {
  if (probDem === undefined) return null;
  const pR = probRep ?? Math.max(0, 1 - probDem);
  const { party, confidence } = leadingFromProbs(probDem, pR);
  const dPct = probDem * 100;
  const rPct = pR * 100;
  const indPct = Math.max(0, 100 - dPct - rPct);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span style={{ color: partyInk("D") }}>D {dPct.toFixed(0)}%</span>
        <span className="text-[var(--color-ink-mute)] text-[10px] tracking-wider">
          {PARTY_LABEL[party]} favored {(confidence * 100).toFixed(0)}%
        </span>
        <span style={{ color: partyInk("R") }}>R {rPct.toFixed(0)}%</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden border border-[var(--color-rule)]">
        <div
          style={{
            width: `${dPct}%`,
            background: tintByOdds("D", Math.max(0.55, probDem)),
          }}
        />
        {indPct > 0.5 && (
          <div
            style={{
              width: `${indPct}%`,
              background:
                "color-mix(in oklab, var(--color-ind) 35%, var(--color-paper))",
            }}
            title={`Independent ${indPct.toFixed(0)}%`}
          />
        )}
        <div
          style={{
            width: `${rPct}%`,
            background: tintByOdds("R", Math.max(0.55, pR)),
          }}
        />
      </div>
    </div>
  );
}
