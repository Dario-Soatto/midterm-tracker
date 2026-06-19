"use client";

import { useEffect, useMemo, useState } from "react";
import { partyInk } from "@/lib/colors";

type Point = { ts: number; pD: number; pR: number };

type Props = {
  eventTicker: string;
  /** SVG height in viewBox units (it scales to fill the parent width). */
  height?: number;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const fmtTickDate = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtHoverDate = (ts: number) => {
  const d = new Date(ts * 1000);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${hh}:${mm}`;
};

/**
 * Two-line price history for one Kalshi event over the last 30 days.
 * P(D) in blue and P(R) in red, plotted from each side's own market
 * candlesticks — so when there's an independent on the ballot (e.g.
 * Nebraska's Osborn) the two lines don't sum to 100% and the residual
 * is the indie's share. The lines no longer mirror across 0.5; the gap
 * between them shows the actual lead.
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setErr(null);
    setHoverIdx(null);
    fetch(`/api/history/${encodeURIComponent(eventTicker)}?days=${days}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setErr(String(data.error));
          return;
        }
        // Tolerate the old API shape (`p` instead of `pD`/`pR`) so the
        // chart doesn't blank out if a client picks up the new bundle
        // before the new server route has deployed.
        const raw: Array<{
          ts: number;
          pD?: number;
          pR?: number;
          p?: number;
        }> = data.points ?? [];
        const normalized: Point[] = raw.map((pt) => {
          if (pt.pD !== undefined && pt.pR !== undefined) {
            return { ts: pt.ts, pD: pt.pD, pR: pt.pR };
          }
          const pD = pt.p ?? 0;
          return { ts: pt.ts, pD, pR: Math.max(0, 1 - pD) };
        });
        setPoints(normalized);
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
    const first = points[0];
    const last = points[points.length - 1];
    return {
      dFirst: first.pD,
      rFirst: first.pR,
      dLast: last.pD,
      rLast: last.pR,
      delta: last.pD - first.pD, // positive = D gained
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
  const pathD = pathFor((pt) => pt.pD);
  const pathR = pathFor((pt) => pt.pR);

  // x-axis ticks: 4 evenly-spaced dated labels covering the requested window
  const oneDay = 86400;
  const step = days / 3; // 7 → ~2.3d, 30 → 10d, 90 → 30d
  const dayTicks: { ts: number; label: string }[] = [];
  for (let i = 3; i >= 0; i--) {
    const d = Math.round(i * step);
    const ts = nowTs - d * oneDay;
    dayTicks.push({ ts, label: fmtTickDate(ts) });
  }

  const midY = yOf(0.5);
  const lastPt = points[points.length - 1];
  const hoverPt = hoverIdx !== null ? points[hoverIdx] : null;
  const displayed = hoverPt ?? lastPt;

  // Map a mouse event over the SVG to the nearest data point's index.
  // The SVG renders at the container's width with preserveAspectRatio="none",
  // so pixel-x → viewBox-x is a straight linear remap by rect.width.
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xViewBox = ((e.clientX - rect.left) / rect.width) * W;
    if (xViewBox < padL || xViewBox > padL + innerW) {
      setHoverIdx(null);
      return;
    }
    const ts = startTs + ((xViewBox - padL) / innerW) * tSpan;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs(points[i].ts - ts);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  return (
    <PanelChrome>
      <PanelHeader
        toggle={toggle}
        currents={{ d: displayed.pD, r: displayed.pR }}
        dateLabel={hoverPt ? fmtHoverDate(hoverPt.ts) : undefined}
      />

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block cursor-crosshair"
        preserveAspectRatio="none"
        style={{ maxHeight: H }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
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
        {/* x-axis day-ticks. The rightmost tick sits flush against the
            chart's right edge, so a centered label would clip past the
            viewBox; anchor it to "end" instead. Mirror behavior for the
            leftmost so it can't collide with the y-axis labels. */}
        {dayTicks.map((t, i) => {
          const isFirst = i === 0;
          const isLast = i === dayTicks.length - 1;
          const anchor = isLast ? "end" : isFirst ? "start" : "middle";
          return (
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
                textAnchor={anchor}
                fontSize={8}
                fontFamily="var(--font-mono)"
                fill="var(--color-ink-mute)"
                style={{ letterSpacing: 0.5 }}
              >
                {t.label}
              </text>
            </g>
          );
        })}
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
        {/* dots: follow the cursor when hovering, otherwise mark "now" */}
        <g pointerEvents="none">
          {hoverPt && (
            <line
              x1={xOf(hoverPt.ts)}
              x2={xOf(hoverPt.ts)}
              y1={padT}
              y2={padT + innerH}
              stroke="var(--color-ink-soft)"
              strokeWidth={0.6}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <circle
            cx={xOf(displayed.ts)}
            cy={yOf(displayed.pR)}
            r={2.4}
            fill={partyInk("R")}
          />
          <circle
            cx={xOf(displayed.ts)}
            cy={yOf(displayed.pD)}
            r={2.4}
            fill={partyInk("D")}
          />
        </g>
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
  dateLabel,
}: {
  toggle: React.ReactNode;
  currents?: { d: number; r: number };
  status?: string;
  dateLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[10px] tracking-wider text-[var(--color-ink-mute)] mb-1">
      {toggle}
      {status && (
        <span className="italic truncate">{status}</span>
      )}
      {currents && (
        <span className="font-mono tabular-nums flex items-baseline gap-2">
          {dateLabel && (
            <span className="text-[var(--color-ink-mute)] normal-case tracking-normal">
              {dateLabel}
            </span>
          )}
          <span style={{ color: partyInk("D") }}>
            D {(currents.d * 100).toFixed(0)}%
          </span>
          <span className="text-[var(--color-ink-mute)]">·</span>
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
