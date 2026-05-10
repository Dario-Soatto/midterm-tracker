"use client";

import { useEffect, useState } from "react";
import OutcomePanel, { type View } from "./OutcomePanel";
import USMap from "./USMap";
import SearchBar, { type Selection } from "./SearchBar";
import { projectBoundaries, type Boundaries } from "@/lib/boundaries";

type Props = {
  districtProbs: Record<string, number>;
  senateProbs: Record<string, number>;
};

export default function Dashboard(props: Props) {
  const [view, setView] = useState<View>("house");
  const [selected, setSelected] = useState<Selection>(null);
  const [boundaries, setBoundaries] = useState<Boundaries | null>(null);

  // Load boundaries once at the dashboard level so SearchBar can read them too.
  useEffect(() => {
    let cancelled = false;
    fetch("/us-boundaries.topo.json")
      .then((r) => r.json())
      .then((topo) => {
        if (cancelled) return;
        setBoundaries(projectBoundaries(topo));
      })
      .catch((err) => console.error("failed to load boundaries", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Clear any selection when the user switches views (a district selection
  // doesn't make sense in the Senate / Governor map and vice-versa).
  useEffect(() => {
    setSelected(null);
  }, [view]);

  return (
    <>
      <section className="py-6 border-b border-[var(--color-rule)]">
        <ViewSelector value={view} onChange={setView} />
      </section>

      <section className="py-10">
        <OutcomePanel view={view} {...props} />
      </section>

      <section className="py-12 border-t border-[var(--color-rule)]">
        <div className="mb-5">
          <SearchBar
            view={view}
            boundaries={boundaries}
            onSelect={setSelected}
          />
        </div>
        <USMap
          view={view}
          boundaries={boundaries}
          selected={selected}
          onSelect={setSelected}
          {...props}
        />
      </section>
    </>
  );
}

function ViewSelector({
  value,
  onChange,
}: {
  value: View;
  onChange: (v: View) => void;
}) {
  const items: { id: View; label: string; sub: string }[] = [
    { id: "house", label: "House", sub: "435 seats · all up" },
    { id: "senate", label: "Senate", sub: "35 seats · 65 holding" },
  ];
  return (
    <div className="flex border border-[var(--color-rule)] divide-x divide-[var(--color-rule)] bg-[var(--color-paper-warm)]">
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={`flex-1 px-5 py-3 text-left transition-colors ${
              active
                ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                : "hover:bg-[var(--color-paper)]"
            }`}
          >
            <div
              className={`font-serif text-xl leading-none ${
                active ? "" : "text-[var(--color-ink)]"
              }`}
            >
              {it.label}
            </div>
            <div
              className={`mt-1 text-[10px] tracking-wider uppercase ${
                active
                  ? "text-[var(--color-paper)]/70"
                  : "text-[var(--color-ink-mute)]"
              }`}
            >
              {it.sub}
            </div>
          </button>
        );
      })}
    </div>
  );
}
