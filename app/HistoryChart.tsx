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
 * Sparkline of P(Democrat wins) over the last 30 days for one Kalshi event.
 *
 * Lazy-fetches `/api/history/<event>` on mount (or when the ticker changes),
 * which is itself cached server-side for 5 min via Next's fetch cache.
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
    const first = points[0].p;
    const last = points[points.length - 1].p;
    return { first, last, delta: last - first };
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

  // Polyline path (M then L*)
  const path = points
    .map((pt, i) => `${i === 0 ? "M" : "L"}${xOf(pt.ts).toFixed(1)},${yOf(pt.p).toFixed(1)}`)
    .join(" ");

  // Filled area under the curve, clipped to the inner box bottom
  const areaPath =
    `M${xOf(points[0].ts).toFixed(1)},${(padT + innerH).toFixed(1)} ` +
    points
      .map((pt) => `L${xOf(pt.ts).toFixed(1)},${yOf(pt.p).toFixed(1)}`)
      .join(" ") +
    ` L${xOf(points[points.length - 1].ts).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  // x-axis ticks: today, -10d, -20d, -30d
  const oneDay = 86400;
  const dayTicks: { ts: number; label: string }[] = [];
  for (let d = 30; d >= 0; d -= 10) {
    const ts = tMax - d * oneDay;
    if (ts < tMin - oneDay) continue;
    dayTicks.push({ ts, label: d === 0 ? "now" : `−${d}d` });
  }

  // Mid line at 0.5
  const midY = yOf(0.5);

  const trendColor =
    stats!.last >= 0.5 ? partyInk("D") : partyInk("R");

  return (
    <PanelChrome>
      <div className="flex items-baseline justify-between text-[10px] tracking-wider text-[var(--color-ink-mute)] mb-1">
        <span>30-day P(D) history</span>
        {stats && (
          <span
            style={{ color: trendColor }}
            className="font-mono tabular-nums"
          >
            {(stats.first * 100).toFixed(0)}% →{" "}
            {(stats.last * 100).toFixed(0)}%
            {Math.abs(stats.delta) >= 0.01 && (
              <span className="text-[var(--color-ink-mute)] ml-1">
                ({stats.delta > 0 ? "+" : ""}
                {(stats.delta * 100).toFixed(0)} pp)
              </span>
            )}
          </span>
        )}
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
        {/* area under the curve, low-opacity in the dem tone */}
        <path
          d={areaPath}
          fill="var(--color-dem)"
          fillOpacity={0.12}
          pointerEvents="none"
        />
        {/* line */}
        <path
          d={path}
          fill="none"
          stroke="var(--color-dem)"
          strokeWidth={1.4}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* endpoint dot */}
        <circle
          cx={xOf(points[points.length - 1].ts)}
          cy={yOf(points[points.length - 1].p)}
          r={2.5}
          fill={trendColor}
        />
      </svg>
    </PanelChrome>
  );
}

function PanelChrome({ children }: { children: React.ReactNode }) {
  return <div className="mt-4">{children}</div>;
}
