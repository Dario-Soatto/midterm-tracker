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
/** Selectable window sizes (days). Kept in sync with ALLOWED_DAYS in the API. */
const WINDOW_OPTIONS = [7, 30, 90] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];

export default function HistoryChart({ eventTicker, height = 110 }: Props) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<WindowDays>(30);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setErr(null);
    fetch(`/api/history/${encodeURIComponent(eventTicker)}?days=${days}`)
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
  }, [eventTicker, days]);

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

  const toggle = (
    <WindowToggle value={days} onChange={setDays} />
  );

  if (err) {
    return (
      <PanelChrome>
        <PanelHeader toggle={toggle} status="history unavailable" />
      </PanelChrome>
    );
  }

  if (!points) {
    return (
      <PanelChrome>
        <PanelHeader toggle={toggle} status={`loading ${days}-day history…`} />
      </PanelChrome>
    );
  }

  if (points.length < 2) {
    return (
      <PanelChrome>
        <PanelHeader
          toggle={toggle}
          status="not enough trading history yet"
        />
      </PanelChrome>
    );
  }

  // SVG layout — viewBox stretched to container width via preserveAspectRatio=none.
  const W = 320;
  const H = height;
  const padL = 24; // room for y-axis labels (0% / 50% / 100%)
  const padR = 6;
  const padT = 6;
  const padB = 14; // room for x-axis ticks
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // X-axis is anchored to the requested window (now → now − days·86400),
  // not to the data extent. That way day-ticks land at consistent positions
  // even when a market only has a few days of trades inside a 90d window.
  const nowTs = Math.floor(Date.now() / 1000);
  const startTs = nowTs - days * 86400;
  const tSpan = Math.max(1, nowTs - startTs);

  const xOf = (ts: number) => padL + ((ts - startTs) / tSpan) * innerW;
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

  // x-axis ticks: 4 evenly-spaced labels covering the requested window
  const oneDay = 86400;
  const step = days / 3; // 7 → ~2.3d, 30 → 10d, 90 → 30d
  const dayTicks: { ts: number; label: string }[] = [];
  for (let i = 3; i >= 0; i--) {
    const d = Math.round(i * step);
    const ts = nowTs - d * oneDay;
    dayTicks.push({ ts, label: d === 0 ? "now" : `−${d}d` });
  }

  const midY = yOf(0.5);
  const lastPt = points[points.length - 1];

  return (
    <PanelChrome>
      <PanelHeader
        toggle={toggle}
        currents={{
          d: stats!.dLast,
          r: stats!.rLast,
        }}
      />

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
        {/* y-axis ticks: 0% / 50% / 100% */}
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <text
              x={padL - 4}
              y={yOf(p) + 3}
              textAnchor="end"
              fontSize={8}
              fontFamily="var(--font-mono)"
              fill="var(--color-ink-mute)"
              style={{ letterSpacing: 0.5 }}
            >
              {(p * 100).toFixed(0)}%
            </text>
            <line
              x1={padL - 2}
              x2={padL}
              y1={yOf(p)}
              y2={yOf(p)}
              stroke="var(--color-ink-mute)"
              strokeWidth={0.4}
            />
          </g>
        ))}
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

function PanelHeader({
  toggle,
  currents,
  status,
}: {
  toggle: React.ReactNode;
  currents?: { d: number; r: number };
  status?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[10px] tracking-wider text-[var(--color-ink-mute)] mb-1">
      {toggle}
      {status && (
        <span className="italic truncate">{status}</span>
      )}
      {currents && (
        <span className="font-mono tabular-nums">
          <span style={{ color: partyInk("D") }}>
            D {(currents.d * 100).toFixed(0)}%
          </span>
          <span className="text-[var(--color-ink-mute)] mx-2">·</span>
          <span style={{ color: partyInk("R") }}>
            R {(currents.r * 100).toFixed(0)}%
          </span>
        </span>
      )}
    </div>
  );
}

function WindowToggle({
  value,
  onChange,
}: {
  value: WindowDays;
  onChange: (v: WindowDays) => void;
}) {
  return (
    <div className="flex">
      {WINDOW_OPTIONS.map((d) => {
        const active = value === d;
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            className={`px-1.5 py-0.5 text-[9px] tracking-widest uppercase border transition-colors ${
              active
                ? "bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]"
                : "border-[var(--color-rule)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:border-[var(--color-ink-soft)]"
            } -ml-px first:ml-0`}
          >
            {d}d
          </button>
        );
      })}
    </div>
  );
}
