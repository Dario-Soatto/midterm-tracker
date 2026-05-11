"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Boundaries } from "@/lib/boundaries";
import { STATES_BY_FIPS, SENATE_2026_STATES } from "@/lib/states";
import {
  PARTY_LABEL,
  leadingFromProbDem,
  tintByOdds,
  partyInk,
  type Party,
} from "@/lib/colors";
import DetailPanel from "./DetailPanel";
import type { View } from "./OutcomePanel";
import type { Selection } from "./SearchBar";

type Props = {
  view: View;
  boundaries: Boundaries | null;
  selected: Selection;
  onSelect: (s: Selection) => void;
  districtProbs: Record<string, number>;
  senateProbs: Record<string, number>;
};

const STROKE_DISTRICT = "color-mix(in oklab, var(--color-ink) 22%, transparent)";

const VIEW_W = 975;
const VIEW_H = 610;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

type Zoom = { x: number; y: number; k: number };
const IDENTITY: Zoom = { x: 0, y: 0, k: 1 };

export default function USMap({
  view,
  boundaries,
  selected,
  onSelect,
  districtProbs,
  senateProbs,
}: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>(IDENTITY);
  const [popupOffset, setPopupOffset] = useState({ dx: 0, dy: 0 });

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // set true on pointerup if the user actually dragged the map; consumed by
  // the next click on a path so a drag doesn't accidentally select something
  const lastWasDragRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  // popup dragging
  const popupDragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startOffset: { dx: number; dy: number };
  } | null>(null);

  // reset zoom + popup offset when view changes
  useEffect(() => {
    setZoom(IDENTITY);
    setPopupOffset({ dx: 0, dy: 0 });
    setHover(null);
  }, [view]);
  // reset popup offset when the selection changes
  useEffect(() => {
    setPopupOffset({ dx: 0, dy: 0 });
  }, [selected]);

  // dismiss the popup on (a) click outside the map container, (b) ESC.
  // mousedowns inside the container — including the popup, the SVG paths, and
  // the zoom toolbar — DON'T close, so:
  //   • clicking a different district just switches selection (the path's
  //     onClick fires after this listener, no close in between)
  //   • interacting with the popup body / drag handle / link doesn't dismiss
  //   • clicking the empty SVG background calls our rect onClick handler,
  //     which closes only when it's a true click (not the start of a pan)
  useEffect(() => {
    if (!selected) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      onSelect(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelect(null);
    };
    // defer attaching so the same click that opened the popup doesn't close it
    const tid = setTimeout(() => {
      window.addEventListener("mousedown", onMouseDown);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(tid);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [selected, onSelect]);

  const tooltip = useMemo(() => {
    if (!boundaries || !hover) return null;
    if (view === "house") {
      const d = boundaries.districts.find((x) => x.geoid === hover);
      if (!d) return null;
      const meta = STATES_BY_FIPS[d.statefips];
      const p = districtProbs[d.geoid];
      if (p === undefined) return `${meta?.abbr ?? ""} · ${d.name}`;
      const { party, confidence } = leadingFromProbDem(p);
      return `${meta?.abbr ?? ""} · ${d.name} — ${PARTY_LABEL[party]} ${(confidence * 100).toFixed(0)}%`;
    } else {
      const s = boundaries.states.find((x) => x.fips === hover);
      if (!s) return null;
      if (!SENATE_2026_STATES.has(s.abbr)) return `${s.name} — no 2026 race`;
      const p = senateProbs[s.abbr];
      if (p === undefined) return s.name;
      const { party, confidence } = leadingFromProbDem(p);
      return `${s.name} — ${PARTY_LABEL[party]} ${(confidence * 100).toFixed(0)}%`;
    }
  }, [boundaries, hover, view, districtProbs, senateProbs]);

  // ---- zoom / pan handlers ------------------------------------------------

  // Wheel-driven zoom.
  //
  // Pattern (matches Mapbox / Google Maps embedded UX):
  //   • Plain wheel scroll WITHOUT ctrl/cmd → page scroll (we don't trap)
  //   • Wheel WITH ctrlKey or metaKey      → zoom toward cursor
  //
  // macOS / Chrome / Safari send a trackpad pinch as `wheel` events with
  // ctrlKey:true automatically, so this single check covers both pinch and
  // explicit ctrl/cmd+scroll for mouse users.
  //
  // The zoom factor scales with deltaY (exp gives multiplicative, gesture-
  // proportional zoom) so a slow pinch zooms slowly and a fast scroll zooms
  // a lot — feels continuous instead of stepped.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // let the page scroll
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mxSvg = ((e.clientX - rect.left) / rect.width) * VIEW_W;
      const mySvg = ((e.clientY - rect.top) / rect.height) * VIEW_H;
      const factor = Math.exp(-e.deltaY * 0.005);
      setZoom((z) => zoomTowardPoint(z, mxSvg, mySvg, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // re-run after boundaries load: the SVG isn't in the DOM during the
    // initial render (we early-return a "loading" div), so svgRef.current
    // is null until boundaries arrive and the SVG actually mounts.
  }, [boundaries]);

  // Pan-by-drag.
  //
  // We deliberately DO NOT call setPointerCapture: capturing the pointer
  // redirects subsequent pointer events away from child <path>s, which kills
  // the click event on districts. Instead we attach window listeners for the
  // duration of the drag — that handles drags that leave the SVG bounds while
  // still letting click events reach the original target.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startZoom = zoom;
    let moved = false;
    let cursorChanged = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 3) {
        moved = true;
        if (!cursorChanged) {
          setIsPanning(true);
          cursorChanged = true;
        }
      }
      if (!moved) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dxSvg = (dx / rect.width) * VIEW_W;
      const dySvg = (dy / rect.height) * VIEW_H;
      setZoom(
        clampZoom({
          ...startZoom,
          x: startZoom.x + dxSvg,
          y: startZoom.y + dySvg,
        }),
      );
    };

    const onUp = () => {
      lastWasDragRef.current = moved;
      if (cursorChanged) setIsPanning(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const consumeClickIfDragged = (cb: () => void) => {
    if (lastWasDragRef.current) {
      lastWasDragRef.current = false;
      return;
    }
    cb();
  };

  // ---- popup positioning + dragging --------------------------------------

  const popupAnchor = useMemo<{ cx: number; cy: number } | null>(() => {
    if (!boundaries || !selected) return null;
    if (selected.kind === "district") {
      const d = boundaries.districts.find((x) => x.geoid === selected.geoid);
      if (!d) return null;
      return { cx: d.centroid[0], cy: d.centroid[1] };
    }
    const s = boundaries.states.find((x) => x.fips === selected.fips);
    if (!s) return null;
    return { cx: s.centroid[0], cy: s.centroid[1] };
  }, [boundaries, selected]);

  const onPopupHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    popupDragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffset: popupOffset,
    };
    const move = (ev: MouseEvent) => {
      const d = popupDragRef.current;
      if (!d) return;
      setPopupOffset({
        dx: d.startOffset.dx + ev.clientX - d.startClientX,
        dy: d.startOffset.dy + ev.clientY - d.startClientY,
      });
    };
    const up = () => {
      popupDragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ---- early return for not-yet-loaded boundaries ------------------------

  if (!boundaries) {
    return (
      <div>
        <div className="border border-[var(--color-rule)] bg-[var(--color-paper-warm)] aspect-[975/610] flex items-center justify-center">
          <span className="text-xs text-[var(--color-ink-mute)]">
            loading 119th-congress district boundaries…
          </span>
        </div>
      </div>
    );
  }

  const { districts, states, stateMeshPath } = boundaries;

  const districtFill = (geoid: string): string => {
    const p = districtProbs[geoid];
    if (p === undefined) return "var(--color-paper-warm)";
    const { party, confidence } = leadingFromProbDem(p);
    return tintByOdds(party, confidence);
  };

  const senateFill = (fips: string): string => {
    const meta = STATES_BY_FIPS[fips];
    if (!meta) return "var(--color-paper-warm)";
    if (!SENATE_2026_STATES.has(meta.abbr))
      return "color-mix(in oklab, var(--color-ink-mute) 8%, var(--color-paper))";
    const p = senateProbs[meta.abbr];
    if (p === undefined) return "var(--color-paper-warm)";
    const { party, confidence } = leadingFromProbDem(p);
    return tintByOdds(party, confidence);
  };

  const onDistrictClick = (geoid: string) =>
    consumeClickIfDragged(() => onSelect({ kind: "district", geoid }));
  const onStateClick = (fips: string) =>
    consumeClickIfDragged(() => onSelect({ kind: "state", fips }));

  const transform = `translate(${zoom.x} ${zoom.y}) scale(${zoom.k})`;

  // popup anchor in % coords (after zoom transform applied)
  let popupStyle: React.CSSProperties | null = null;
  // Flip popup below the centroid when the centroid is near the top of the
  // visible viewBox — the default placement (above) would render off-screen.
  let popupBelow = false;
  if (popupAnchor) {
    const px = (zoom.x + popupAnchor.cx * zoom.k) / VIEW_W; // 0..1
    const py = (zoom.y + popupAnchor.cy * zoom.k) / VIEW_H;
    popupStyle = {
      left: `calc(${(px * 100).toFixed(2)}% + ${popupOffset.dx}px)`,
      top: `calc(${(py * 100).toFixed(2)}% + ${popupOffset.dy}px)`,
    };
    popupBelow = py < 0.45;
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5 gap-4 flex-wrap">
        <h2 className="text-xs tracking-widest text-[var(--color-ink-soft)] uppercase">
          02 · the map
        </h2>
        <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
          pinch or ⌘ + scroll to zoom · drag to pan
        </span>
      </div>

      <div
        ref={containerRef}
        className="border border-[var(--color-rule)] bg-[var(--color-paper-warm)] relative"
      >
        {/* Clip only the zoomable SVG; the popup is a sibling of this clipped
            wrapper so it can extend beyond the map borders without being cut. */}
        <div className="overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-auto block select-none"
          role="img"
          aria-label="2026 U.S. midterm election map"
          onPointerDown={onPointerDown}
          style={{ cursor: isPanning ? "grabbing" : "grab" }}
        >
          {/* background rect: receives drag-pan over empty space, and closes
              the popup when the user clicks an empty area (e.g. the Pacific) */}
          <rect
            x={0}
            y={0}
            width={VIEW_W}
            height={VIEW_H}
            fill="transparent"
            onClick={() =>
              consumeClickIfDragged(() => {
                if (selected) onSelect(null);
              })
            }
          />

          <g transform={transform}>
            {view === "house" ? (
              <g>
                {districts.map((d) => (
                  <path
                    key={d.geoid}
                    d={d.path}
                    fill={districtFill(d.geoid)}
                    stroke={STROKE_DISTRICT}
                    strokeWidth={0.4}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHover(d.geoid)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onDistrictClick(d.geoid)}
                  />
                ))}
              </g>
            ) : (
              <g>
                {states.map((s) => {
                  const fill = senateFill(s.fips);
                  const eligible = SENATE_2026_STATES.has(s.abbr);
                  return (
                    <path
                      key={s.fips}
                      d={s.path}
                      fill={fill}
                      stroke="color-mix(in oklab, var(--color-ink) 25%, transparent)"
                      strokeWidth={0.4}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: eligible ? "pointer" : "default" }}
                      onMouseEnter={() => setHover(s.fips)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => eligible && onStateClick(s.fips)}
                    />
                  );
                })}
              </g>
            )}

            {/* state-border overlay */}
            <path
              d={stateMeshPath}
              fill="none"
              stroke={view === "house" ? "var(--color-ink)" : "transparent"}
              strokeWidth={1.1}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />

            {/* hover & selection overlays — drawn last */}
            {(() => {
              const hoverPath =
                view === "house"
                  ? districts.find((d) => d.geoid === hover)?.path
                  : states.find((s) => s.fips === hover)?.path;
              const selectedPath =
                selected?.kind === "district"
                  ? districts.find((d) => d.geoid === selected.geoid)?.path
                  : selected?.kind === "state"
                    ? states.find((s) => s.fips === selected.fips)?.path
                    : undefined;
              const selectedKey =
                selected?.kind === "district"
                  ? selected.geoid
                  : selected?.kind === "state"
                    ? selected.fips
                    : null;
              return (
                <>
                  {hoverPath && hover !== selectedKey && (
                    <path
                      d={hoverPath}
                      fill="none"
                      stroke="var(--color-ink)"
                      strokeWidth={1.1}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  )}
                  {selectedPath && (
                    <path
                      d={selectedPath}
                      fill="none"
                      stroke="var(--color-ink)"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  )}
                </>
              );
            })()}

            {/* state-abbr labels (Senate / Governor view only) */}
            {view !== "house" &&
              states.map((s) => {
                if (
                  Number.isNaN(s.centroid[0]) ||
                  Number.isNaN(s.centroid[1]) ||
                  !Number.isFinite(s.centroid[0]) ||
                  !Number.isFinite(s.centroid[1])
                )
                  return null;
                return (
                  <text
                    key={`l-${s.fips}`}
                    x={s.centroid[0]}
                    y={s.centroid[1]}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    pointerEvents="none"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9 / zoom.k,
                      letterSpacing: 1 / zoom.k,
                      fill: "color-mix(in oklab, var(--color-ink) 70%, transparent)",
                    }}
                  >
                    {s.abbr}
                  </text>
                );
              })}
          </g>
        </svg>
        </div>

        {/* zoom toolbar */}
        <ZoomToolbar
          k={zoom.k}
          onZoomIn={() =>
            setZoom((z) => zoomTowardPoint(z, VIEW_W / 2, VIEW_H / 2, 1.5))
          }
          onZoomOut={() =>
            setZoom((z) => zoomTowardPoint(z, VIEW_W / 2, VIEW_H / 2, 1 / 1.5))
          }
          onReset={() => setZoom(IDENTITY)}
        />

        {/* tooltip */}
        <div className="pointer-events-none absolute left-3 bottom-3 text-[10px] tracking-wider text-[var(--color-ink-mute)] bg-[var(--color-paper)]/90 px-2 py-1 border border-[var(--color-rule)] min-h-6 max-w-[420px]">
          {tooltip ?? "hover · click · scroll · drag"}
        </div>

        <Legend />

        {/* popup anchored to the selected feature, draggable */}
        {selected && popupStyle && (
          <FloatingPopup
            style={popupStyle}
            flipBelow={popupBelow}
            onHeaderMouseDown={onPopupHeaderMouseDown}
          >
            <DetailPanel
              view={view}
              selected={selected}
              boundaries={boundaries}
              districtProbs={districtProbs}
              senateProbs={senateProbs}
              onClose={() => onSelect(null)}
            />
          </FloatingPopup>
        )}
      </div>
    </div>
  );
}

// ---- helpers --------------------------------------------------------------

function zoomTowardPoint(z: Zoom, ax: number, ay: number, factor: number): Zoom {
  const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z.k * factor));
  if (newK === z.k) return z;
  const realFactor = newK / z.k;
  // anchor (ax, ay) is in unzoomed SVG coords; we want screen position to stay put
  return clampZoom({
    k: newK,
    x: ax - (ax - z.x) * realFactor,
    y: ay - (ay - z.y) * realFactor,
  });
}

function clampZoom(z: Zoom): Zoom {
  const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z.k));
  // At k = 1 the projection is already perfectly fitted by `fitExtent`, so the
  // only valid translation is (0, 0) — anything else would clip the map.
  if (k <= 1) return { k: 1, x: 0, y: 0 };
  // When zoomed in, allow panning but never expose empty viewBox space:
  //   visible x-range of inner content is [-x/k, (VIEW_W - x)/k]
  //   for that range to be ⊆ [0, VIEW_W]:
  //     -x/k ≥ 0          → x ≤ 0
  //     (VIEW_W - x)/k ≤ VIEW_W → x ≥ VIEW_W (1 - k)
  return {
    k,
    x: Math.max(VIEW_W * (1 - k), Math.min(0, z.x)),
    y: Math.max(VIEW_H * (1 - k), Math.min(0, z.y)),
  };
}

function FloatingPopup({
  style,
  flipBelow,
  onHeaderMouseDown,
  children,
}: {
  style: React.CSSProperties;
  flipBelow: boolean;
  onHeaderMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  // The popup "anchor" is the centroid (style.left/top). By default we float
  // ABOVE it (translate-y -100% - 14px so the popup's bottom sits 14px above
  // the centroid). When the centroid is near the top of the map, we flip to
  // float BELOW (translate-y +14px). The tail (rotated square) moves to the
  // opposite edge so it always points at the centroid.
  const dragHandle = (
    <div
      onMouseDown={onHeaderMouseDown}
      className="h-3 bg-[var(--color-ink)] flex items-center justify-center gap-1 cursor-move select-none"
    >
      <span className="block h-[3px] w-[3px] rounded-full bg-[var(--color-paper)]/40" />
      <span className="block h-[3px] w-[3px] rounded-full bg-[var(--color-paper)]/40" />
      <span className="block h-[3px] w-[3px] rounded-full bg-[var(--color-paper)]/40" />
    </div>
  );

  const body = (
    <div
      className={`bg-[var(--color-paper)] border border-[var(--color-ink)] shadow-[0_8px_32px_-12px_rgba(26,26,26,0.45)] ${flipBelow ? "border-t-0" : "border-t-0"}`}
    >
      {children}
    </div>
  );

  return (
    <div
      role="dialog"
      aria-label="race detail"
      style={style}
      className={`absolute z-30 w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 ${
        flipBelow
          ? "translate-y-[14px]"
          : "-translate-y-[calc(100%+14px)]"
      }`}
    >
      {flipBelow ? (
        <>
          {/* tail above (points up at centroid) */}
          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 -top-[7px] w-3 h-3 rotate-45 bg-[var(--color-ink)]"
          />
          {dragHandle}
          {body}
        </>
      ) : (
        <>
          {dragHandle}
          {body}
          {/* tail below (points down at centroid) */}
          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 -bottom-[7px] w-3 h-3 rotate-45 bg-[var(--color-paper)] border-r border-b border-[var(--color-ink)]"
          />
        </>
      )}
    </div>
  );
}

function ZoomToolbar({
  k,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  k: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const btn =
    "h-8 w-8 flex items-center justify-center bg-[var(--color-paper)]/95 hover:bg-[var(--color-paper)] border border-[var(--color-rule)] text-[var(--color-ink)] disabled:text-[var(--color-ink-mute)] disabled:cursor-not-allowed transition";
  return (
    <div className="absolute top-3 left-3 flex flex-col gap-px">
      <button
        onClick={onZoomIn}
        disabled={k >= MAX_ZOOM}
        className={btn}
        aria-label="zoom in"
        title="zoom in"
      >
        <span className="text-base leading-none">+</span>
      </button>
      <button
        onClick={onZoomOut}
        disabled={k <= MIN_ZOOM}
        className={btn}
        aria-label="zoom out"
        title="zoom out"
      >
        <span className="text-base leading-none">−</span>
      </button>
      <button
        onClick={onReset}
        disabled={k === MIN_ZOOM}
        className={`${btn} text-[10px] tracking-widest`}
        aria-label="reset zoom"
        title="reset zoom"
      >
        ⟲
      </button>
      <div className="text-[9px] tracking-wider text-[var(--color-ink-mute)] text-center mt-1 font-mono">
        {k.toFixed(1)}×
      </div>
    </div>
  );
}

function Legend() {
  const swatches = (party: Party) => (
    <div className="flex gap-[2px]">
      {[1, 0.7, 0.4].map((c) => (
        <span
          key={c}
          className="block h-3 w-3"
          style={{ backgroundColor: tintByOdds(party, 0.5 + c / 2) }}
        />
      ))}
    </div>
  );
  return (
    <div className="absolute right-3 bottom-3 flex items-center gap-4 text-[10px] tracking-wider text-[var(--color-ink-soft)] bg-[var(--color-paper)]/90 px-2 py-1 border border-[var(--color-rule)]">
      <div className="flex items-center gap-1.5">
        {swatches("D")}
        <span style={{ color: partyInk("D") }}>D</span>
      </div>
      <div className="flex items-center gap-1.5">
        {swatches("R")}
        <span style={{ color: partyInk("R") }}>R</span>
      </div>
    </div>
  );
}
