"use client";

import { useMemo } from "react";
import {
  BUCKET_COLOR_VAR,
  BUCKET_LABEL,
  BUCKET_ORDER,
  bucketCounts,
  distSummary,
  poissonBinomialPMF,
  type Bucket,
} from "@/lib/distribution";

export type View = "house" | "senate";

type Props = {
  view: View;
  districtProbs: Record<string, number>;
  senateProbs: Record<string, number>;
};

const VIEW_TITLES: Record<View, string> = {
  house: "house — 435 seats",
  senate: "senate — 35 contested · 65 holding",
};

const VIEW_MAJORITY: Record<View, number> = {
  house: 218,
  senate: 50,
};

const VIEW_TOTAL: Record<View, number> = {
  house: 435,
  senate: 100,
};

/**
 * Senate seats already locked in (not on the ballot in 2026):
 *   Class 1 holding (32: 33 elected 2024 minus Vance/OH special)
 *   Class 3 holding (33: 34 elected 2022 minus Rubio/FL special)
 * = 65 holding. Rough D/R split below; will be replaced with live counts.
 */
const SENATE_BASE = { D: 32, R: 33 };

export default function OutcomePanel({
  view,
  districtProbs,
  senateProbs,
}: Props) {
  const data = useMemo(() => {
    const probs =
      view === "house"
        ? Object.values(districtProbs)
        : Object.values(senateProbs);

    const buckets = bucketCounts(probs);
    const pmf = poissonBinomialPMF(probs);
    const summary = distSummary(pmf);

    const baseDOffset = view === "senate" ? SENATE_BASE.D : 0;
    const baseROffset = view === "senate" ? SENATE_BASE.R : 0;

    return { probs, buckets, pmf, summary, baseDOffset, baseROffset };
  }, [view, districtProbs, senateProbs]);

  const total = VIEW_TOTAL[view];
  const majorityAt = VIEW_MAJORITY[view];

  const dMean = data.summary.mean + data.baseDOffset;
  const rMean = total - dMean;
  const winnerLabel =
    dMean >= majorityAt ? "D-leaning" : rMean >= majorityAt ? "R-leaning" : "no clear majority";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5 gap-4 flex-wrap">
        <h2 className="text-xs tracking-widest text-[var(--color-ink-soft)] uppercase">
          01 · expected outcomes — {VIEW_TITLES[view]}
        </h2>
        <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
          independent-races assumption · monte carlo with correlation in v2
        </span>
      </div>

      <div className="border border-[var(--color-rule)] bg-[var(--color-paper-warm)] px-6 py-5">
        <div className="flex items-baseline gap-6 mb-5 flex-wrap">
          <div className="flex items-baseline gap-2">
            <span
              className="font-serif text-3xl"
              style={{ color: "var(--color-dem)" }}
            >
              {dMean.toFixed(0)}
            </span>
            <span className="text-[var(--color-ink-mute)] text-xs">vs</span>
            <span
              className="font-serif text-3xl"
              style={{ color: "var(--color-rep)" }}
            >
              {rMean.toFixed(0)}
            </span>
            <span className="ml-3 text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]">
              expected ·{" "}
              <span
                style={{
                  color:
                    dMean >= majorityAt
                      ? "var(--color-dem)"
                      : rMean >= majorityAt
                        ? "var(--color-rep)"
                        : "var(--color-tossup)",
                }}
              >
                {winnerLabel}
              </span>
            </span>
          </div>

          <div className="text-[10px] tracking-wider text-[var(--color-ink-mute)] ml-auto">
            ±{data.summary.std.toFixed(1)} σ · 90% CI{" "}
            {(data.summary.quantile(0.05) + data.baseDOffset).toFixed(0)}–
            {(data.summary.quantile(0.95) + data.baseDOffset).toFixed(0)} D
          </div>
        </div>

        <Density
          pmf={data.pmf}
          baseDOffset={data.baseDOffset}
          total={total}
          majorityAt={majorityAt}
        />

        <div className="mt-5">
          <BucketBar
            segments={buildSegments(
              data.buckets,
              data.baseDOffset,
              data.baseROffset,
            )}
            total={total}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          {buildSegments(data.buckets, data.baseDOffset, data.baseROffset)
            .filter((s) => s.count > 0)
            .map((s) => (
              <BucketLegendCell key={s.key} segment={s} />
            ))}
        </div>
      </div>
    </div>
  );
}

type Segment = {
  key: string;
  label: string;
  count: number;
  color: string;
  /** Light text on the segment instead of dark. */
  isDark?: boolean;
};

const HOLDING_D_COLOR =
  "color-mix(in oklab, var(--color-dem) 80%, var(--color-ink))";
const HOLDING_R_COLOR =
  "color-mix(in oklab, var(--color-rep) 80%, var(--color-ink))";

/**
 * Build the ordered list of segments shown in the bucket bar (and legend).
 * For Senate, the seats not on the ballot in 2026 (`baseD` Democrats holding,
 * `baseR` Republicans holding) get their own segments at the two extremes —
 * they're already locked in, so visually they read as distinct from the
 * "Safe D / Safe R" buckets that come from contested-but-very-likely races.
 */
function buildSegments(
  buckets: Record<Bucket, number>,
  baseD: number,
  baseR: number,
): Segment[] {
  const out: Segment[] = [];
  if (baseD > 0) {
    out.push({
      key: "holding-d",
      label: "Holding D",
      count: baseD,
      color: HOLDING_D_COLOR,
      isDark: true,
    });
  }
  for (const b of BUCKET_ORDER) {
    out.push({
      key: b,
      label: BUCKET_LABEL[b],
      count: buckets[b],
      color: BUCKET_COLOR_VAR[b],
      isDark: b === "safe-d" || b === "safe-r",
    });
  }
  if (baseR > 0) {
    out.push({
      key: "holding-r",
      label: "Holding R",
      count: baseR,
      color: HOLDING_R_COLOR,
      isDark: true,
    });
  }
  return out;
}

function BucketLegendCell({ segment }: { segment: Segment }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="inline-block h-2 w-2 shrink-0 translate-y-[1px]"
        style={{ background: segment.color }}
      />
      <span className="text-[var(--color-ink-soft)] tracking-wider whitespace-nowrap">
        {segment.label}
      </span>
      <span className="text-[var(--color-ink)] font-mono tabular-nums">
        {segment.count}
      </span>
    </div>
  );
}

function BucketBar({
  segments,
  total,
}: {
  segments: Segment[];
  total: number;
}) {
  const widthFor = (count: number) => `${(count / total) * 100}%`;
  return (
    <div className="relative h-7 flex w-full border border-[var(--color-rule)]">
      {segments.map((s) =>
        s.count === 0 ? null : (
          <div
            key={s.key}
            className="h-full relative"
            style={{
              width: widthFor(s.count),
              background: s.color,
            }}
            title={`${s.label}: ${s.count}`}
          >
            {s.count >= Math.max(8, total * 0.04) && (
              <span
                className="absolute inset-0 flex items-center justify-center text-[10px] font-mono tabular-nums"
                style={{
                  color: s.isDark
                    ? "var(--color-paper)"
                    : "var(--color-ink)",
                }}
              >
                {s.count}
              </span>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function Density({
  pmf,
  baseDOffset,
  total,
  majorityAt,
}: {
  pmf: number[];
  baseDOffset: number;
  total: number;
  majorityAt: number;
}) {
  // Trim x range to where probability mass is meaningful (≥ 1e-4),
  // with a small pad for legibility.
  const minMass = 1e-4;
  let lo = 0;
  while (lo < pmf.length && pmf[lo] < minMass) lo++;
  let hi = pmf.length - 1;
  while (hi > 0 && pmf[hi] < minMass) hi--;
  if (lo >= hi) {
    lo = 0;
    hi = pmf.length - 1;
  }
  // Pad
  const pad = Math.max(2, Math.round((hi - lo) * 0.15));
  const xMin = Math.max(0, lo - pad) + baseDOffset;
  const xMax = Math.min(pmf.length - 1, hi + pad) + baseDOffset;

  // SVG dims (viewBox); scaled by container
  const W = 1000;
  const H = 200;
  const padTop = 10;
  const padBottom = 26;
  const innerH = H - padTop - padBottom;

  let maxP = 0;
  for (let k = lo; k <= hi; k++) if (pmf[k] > maxP) maxP = pmf[k];
  if (maxP === 0) maxP = 1;

  const xRange = xMax - xMin;
  const xFor = (k: number) => ((k + baseDOffset - xMin) / xRange) * W;
  const barW = (W / xRange) * 0.92;

  // x-axis ticks: ~5 round numbers
  const tickCount = 5;
  const niceStep = niceTickStep(xRange / tickCount);
  const ticks: number[] = [];
  for (
    let t = Math.ceil(xMin / niceStep) * niceStep;
    t <= xMax;
    t += niceStep
  ) {
    ticks.push(t);
  }

  // majority line
  const majorityX = xFor(majorityAt - baseDOffset);
  const majorityVisible = majorityAt >= xMin && majorityAt <= xMax;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto block"
      preserveAspectRatio="none"
      style={{ maxHeight: 200 }}
    >
      {/* baseline */}
      <line
        x1={0}
        x2={W}
        y1={H - padBottom}
        y2={H - padBottom}
        stroke="var(--color-rule)"
        strokeWidth={0.5}
      />

      {/* density bars */}
      {pmf.map((p, k) => {
        if (p < minMass / 5) return null;
        const x = xFor(k);
        if (x < -barW || x > W + barW) return null;
        const seatCount = k + baseDOffset;
        const isD = seatCount >= majorityAt;
        const h = (p / maxP) * innerH;
        return (
          <rect
            key={k}
            x={x - barW / 2}
            y={H - padBottom - h}
            width={barW}
            height={h}
            fill={isD ? "var(--color-dem)" : "var(--color-rep)"}
            opacity={0.85}
          />
        );
      })}

      {/* majority threshold */}
      {majorityVisible && (
        <>
          <line
            x1={majorityX}
            x2={majorityX}
            y1={padTop - 4}
            y2={H - padBottom + 4}
            stroke="var(--color-ink)"
            strokeWidth={1.2}
            strokeDasharray="3 3"
          />
          <text
            x={majorityX}
            y={padTop + 2}
            textAnchor="middle"
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="var(--color-ink)"
            style={{ letterSpacing: 1 }}
          >
            majority {majorityAt}
          </text>
        </>
      )}

      {/* x-axis ticks */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={xFor(t - baseDOffset)}
            x2={xFor(t - baseDOffset)}
            y1={H - padBottom}
            y2={H - padBottom + 3}
            stroke="var(--color-ink-mute)"
            strokeWidth={0.5}
          />
          <text
            x={xFor(t - baseDOffset)}
            y={H - 6}
            textAnchor="middle"
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="var(--color-ink-mute)"
            style={{ letterSpacing: 1 }}
          >
            {t}
          </text>
        </g>
      ))}
    </svg>
  );
}

function niceTickStep(rough: number): number {
  if (rough <= 0) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const m = rough / base;
  let nice;
  if (m < 1.5) nice = 1;
  else if (m < 3) nice = 2;
  else if (m < 7) nice = 5;
  else nice = 10;
  return Math.max(1, nice * base);
}
