"use client";

import { useEffect, useMemo, useState } from "react";
import { partyInk } from "@/lib/colors";

type Point = { ts: number; p: number };

type Props = {
  eventTicker: string;
  /** SVG height in viewBox units (it scales to fill the parent width). */
  height?: number;
};

/**
 * Two-line price history for one Kalshi event over the last 30 days.
 * P(D) in blue and P(R) = 1 − P(D) in red — the standard election-tracker
 * presentation. Both lines mirror each other across the 0.5 reference;
 * the visual shows the lead (gap between the lines) at a glance.
 *
 * Lazy-fetches `/api/history/<event>` on mount (or when the ticker changes);
 * the API route caches Kalshi responses for 5 min via Next's fetch cache.
 */
export default function HistoryChart({ eventTicker, height = 110 }: Props) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setErr(null);
    fetch(`/api/history/${encodeURIComponent(eventTicker)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setErr(String(data.error));
        else setPoints(data.points ?? []);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [eventTicker]);

  const stats = useMemo(() => {
    if (!points || points.length === 0) return null;
    const dFirst = points[0].p;
    const dLast = points[points.length - 1].p;
    return {
      dFirst,
      dLast,
      rFirst: 1 - dFirst,
      rLast: 1 - dLast,
      delta: dLast - dFirst, // positive = D gained
    };
  }, [points]);

  if (err) {
    return (
      <PanelChrome>
        <span className="text-[10px] text-[var(--color-ink-mute)] italic">
          history unavailable
        </span>
      </PanelChrome>
    );
  }

  if (!points) {
    return (
      <PanelChrome>
        <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
          loading 30-day history…
        </span>
      </PanelChrome>
    );
  }

  if (points.length < 2) {
    return (
      <PanelChrome>
        <span className="text-[10px] text-[var(--color-ink-mute)] italic">
          not enough trading history yet
        </span>
      </PanelChrome>
    );
  }

  // SVG layout — viewBox stretched to container width via preserveAspectRatio=none.
  const W = 320;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 6;
  const padB = 14; // room for x-axis ticks
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const tMin = points[0].ts;
  const tMax = points[points.length - 1].ts;
  const tSpan = Math.max(1, tMax - tMin);

  const xOf = (ts: number) => padL + ((ts - tMin) / tSpan) * innerW;
  const yOf = (p: number) => padT + (1 - p) * innerH;

  // Polyline paths
  const pathFor = (probAt: (pt: Point) => number) =>
    points
      .map(
        (pt, i) =>
          `${i === 0 ? "M" : "L"}${xOf(pt.ts).toFixed(1)},${yOf(probAt(pt)).toFixed(1)}`,
      )
      .join(" ");
  const pathD = pathFor((pt) => pt.p);
  const pathR = pathFor((pt) => 1 - pt.p);

  // x-axis ticks: -30d / -20d / -10d / now
  const oneDay = 86400;
  const dayTicks: { ts: number; label: string }[] = [];
  for (let d = 30; d >= 0; d -= 10) {
    const ts = tMax - d * oneDay;
    if (ts < tMin - oneDay) continue;
    dayTicks.push({ ts, label: d === 0 ? "now" : `−${d}d` });
  }

  const midY = yOf(0.5);
  const lastPt = points[points.length - 1];

  return (
    <PanelChrome>
      <div className="flex items-baseline justify-between text-[10px] tracking-wider text-[var(--color-ink-mute)] mb-1">
        <span>30-day history</span>
        <span className="font-mono tabular-nums">
          <span style={{ color: partyInk("D") }}>
            D {(stats!.dLast * 100).toFixed(0)}%
          </span>
          <span className="text-[var(--color-ink-mute)] mx-2">·</span>
          <span style={{ color: partyInk("R") }}>
            R {(stats!.rLast * 100).toFixed(0)}%
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        preserveAspectRatio="none"
        style={{ maxHeight: H }}
      >
        {/* inner-box frame */}
        <rect
          x={padL}
          y={padT}
          width={innerW}
          height={innerH}
          fill="var(--color-paper)"
          stroke="var(--color-rule)"
          strokeWidth={0.5}
        />
        {/* mid line at 0.5 */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={midY}
          y2={midY}
          stroke="var(--color-rule)"
          strokeWidth={0.5}
          strokeDasharray="3 3"
        />
        {/* x-axis day-ticks */}
        {dayTicks.map((t) => (
          <g key={t.label}>
            <line
              x1={xOf(t.ts)}
              x2={xOf(t.ts)}
              y1={padT + innerH}
              y2={padT + innerH + 3}
              stroke="var(--color-ink-mute)"
              strokeWidth={0.4}
            />
            <text
              x={xOf(t.ts)}
              y={H - 2}
              textAnchor="middle"
              fontSize={8}
              fontFamily="var(--font-mono)"
              fill="var(--color-ink-mute)"
              style={{ letterSpacing: 0.5 }}
            >
              {t.label}
            </text>
          </g>
        ))}
        {/* R line first so D draws on top when they cross — D is the headline */}
        <path
          d={pathR}
          fill="none"
          stroke={partyInk("R")}
          strokeWidth={1.4}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathD}
          fill="none"
          stroke={partyInk("D")}
          strokeWidth={1.4}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* endpoint dots — one per line */}
        <circle
          cx={xOf(lastPt.ts)}
          cy={yOf(1 - lastPt.p)}
          r={2.4}
          fill={partyInk("R")}
        />
        <circle
          cx={xOf(lastPt.ts)}
          cy={yOf(lastPt.p)}
          r={2.4}
          fill={partyInk("D")}
        />
      </svg>
    </PanelChrome>
  );
}

function PanelChrome({ children }: { children: React.ReactNode }) {
  return <div className="mt-4">{children}</div>;
}
