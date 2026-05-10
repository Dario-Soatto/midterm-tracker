"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Boundaries } from "@/lib/boundaries";
import { STATES_BY_FIPS, SENATE_2026_STATES } from "@/lib/states";
import type { View } from "./OutcomePanel";

export type Selection =
  | { kind: "district"; geoid: string }
  | { kind: "state"; fips: string }
  | null;

type Props = {
  view: View;
  boundaries: Boundaries | null;
  onSelect: (s: Selection) => void;
};

type ResultRow = {
  key: string;
  label: string;
  sub: string;
  selection: Exclude<Selection, null>;
  /** Lower-cased searchable string. */
  search: string;
};

export default function SearchBar({ view, boundaries, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const all: ResultRow[] = useMemo(() => {
    if (!boundaries) return [];
    if (view === "house") {
      return boundaries.districts.map((d) => {
        const meta = STATES_BY_FIPS[d.statefips];
        const cdNum = Number(d.cd) || null;
        const cdLabel = cdNum ? `CD-${cdNum}` : "AL";
        // Build many search tokens so users can find a district via any of:
        // "TX-23", "tx 23", "Texas 23", "Brooklyn", "Texas-23", "23rd Texas"
        const tokens = [
          meta?.abbr ?? "",
          meta?.name ?? "",
          d.name,
          cdLabel,
          cdNum ? `${meta?.abbr}-${cdNum}` : "",
          cdNum ? `${meta?.abbr}${cdNum}` : "",
          cdNum ? `${meta?.name} ${cdNum}` : "",
          cdNum ? `${meta?.name}-${cdNum}` : "",
        ];
        return {
          key: d.geoid,
          label: `${meta?.abbr ?? "??"} ${cdLabel}`,
          sub: `${meta?.name ?? ""} · ${d.name}`,
          selection: { kind: "district", geoid: d.geoid } as const,
          search: tokens.join(" ").toLowerCase(),
        };
      });
    }
    return boundaries.states
      .filter((s) => SENATE_2026_STATES.has(s.abbr))
      .map((s) => ({
        key: s.fips,
        label: s.name,
        sub: "U.S. Senate · 2026",
        selection: { kind: "state", fips: s.fips } as const,
        search: `${s.abbr} ${s.name}`.toLowerCase(),
      }));
  }, [view, boundaries]);

  /** Strip whitespace/punctuation for forgiving matching ("TX-23" === "tx 23"). */
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const results = useMemo(() => {
    const raw = query.trim();
    if (!raw) return all.slice(0, 8);
    const qLower = raw.toLowerCase();
    const qNorm = norm(raw);
    const scored = all
      .map((r) => {
        const idx = r.search.indexOf(qLower);
        if (idx >= 0) return { row: r, score: idx === 0 ? 0 : idx + 1 };
        // fallback: match against punctuation-stripped string ("TX-23" → "tx23")
        const idxN = norm(r.search).indexOf(qNorm);
        if (idxN >= 0) return { row: r, score: 1000 + idxN };
        return null;
      })
      .filter(Boolean) as Array<{ row: ResultRow; score: number }>;
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 10).map((s) => s.row);
  }, [query, all]);

  // close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  // reset query when view flips
  useEffect(() => {
    setQuery("");
    setActiveIdx(0);
  }, [view]);

  const pick = (sel: Exclude<Selection, null>) => {
    onSelect(sel);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) pick(r.selection);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const placeholder =
    view === "house"
      ? "Search a district  e.g. TX-23, California 12, Brooklyn"
      : "Search a 2026 senate race  e.g. Georgia, North Carolina";

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full bg-[var(--color-paper-warm)] border border-[var(--color-rule)] focus:border-[var(--color-ink)] focus:outline-none px-4 py-2.5 text-sm font-mono placeholder:text-[var(--color-ink-mute)]"
      />

      {open && query.trim() && results.length === 0 && (
        <div className="absolute left-0 right-0 mt-px z-30 bg-[var(--color-paper)] border border-[var(--color-ink)] px-4 py-3 text-xs text-[var(--color-ink-mute)]">
          no matches for &ldquo;{query}&rdquo;
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 mt-px z-30 max-h-80 overflow-auto bg-[var(--color-paper)] border border-[var(--color-ink)] shadow-[0_8px_32px_-12px_rgba(26,26,26,0.35)]">
          {results.map((r, i) => (
            <button
              key={r.key}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => pick(r.selection)}
              className={`w-full text-left px-4 py-2 flex items-baseline justify-between gap-4 ${
                i === activeIdx
                  ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                  : "hover:bg-[var(--color-paper-warm)]"
              }`}
            >
              <span className="font-mono text-sm">{r.label}</span>
              <span
                className={`text-[10px] tracking-wider truncate ${
                  i === activeIdx
                    ? "text-[var(--color-paper)]/70"
                    : "text-[var(--color-ink-mute)]"
                }`}
              >
                {r.sub}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
