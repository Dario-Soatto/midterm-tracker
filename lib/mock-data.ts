import { STATES, STATES_BY_FIPS, SENATE_2026_STATES, GOVERNOR_2026_STATES } from "./states";

/**
 * Deterministic mock data so the UI looks plausible before Kalshi is wired up.
 * Probabilities are P(Democrat wins). Replace with live odds in the data layer.
 */

function hash32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const noise = (key: string) => (hash32(key) / 0xffffffff) * 2 - 1;

/** P(D wins) for each House district, keyed by Census GEOID (statefips + cd119fp). */
export const DISTRICT_PROB_DEM: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const s of STATES) {
    if (s.districts === 0) continue;
    for (let d = 1; d <= s.districts; d++) {
      const cd = s.districts === 1 ? "00" : String(d).padStart(2, "0");
      const geoid = s.fips + cd;
      // base on state lean, scatter per-district
      const scatter = noise(geoid) * 0.35;
      let p = 0.5 + s.lean * 0.45 + scatter;
      // a few districts flip the lean to keep things realistic
      if (Math.abs(noise(geoid + "flip")) > 0.85) {
        p = 0.5 - (p - 0.5) * 0.6;
      }
      // clamp + push toward extremes a bit (most districts are safe)
      p = Math.max(0.02, Math.min(0.98, p));
      const sign = p >= 0.5 ? 1 : -1;
      const pull = Math.pow(Math.abs(p - 0.5) * 2, 0.85) * 0.5;
      p = 0.5 + sign * pull;
      out[geoid] = Math.round(p * 1000) / 1000;
    }
  }
  return out;
})();

/** P(D wins) for each Senate race in 2026, keyed by state abbr. */
export const SENATE_PROB_DEM: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const abbr of SENATE_2026_STATES) {
    const s = STATES.find((x) => x.abbr === abbr);
    if (!s) continue;
    const p = 0.5 + s.lean * 0.55 + noise("S" + abbr) * 0.12;
    out[abbr] = Math.max(0.02, Math.min(0.98, Math.round(p * 1000) / 1000));
  }
  return out;
})();

/** P(D wins) for each Governor race in 2026, keyed by state abbr. */
export const GOV_PROB_DEM: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const abbr of GOVERNOR_2026_STATES) {
    const s = STATES.find((x) => x.abbr === abbr);
    if (!s) continue;
    // governors don't track partisan lean as tightly; mix in incumbent-style noise
    const p = 0.5 + s.lean * 0.4 + noise("G" + abbr) * 0.22;
    out[abbr] = Math.max(0.05, Math.min(0.95, Math.round(p * 1000) / 1000));
  }
  return out;
})();

export function districtProb(geoid: string): number | undefined {
  return DISTRICT_PROB_DEM[geoid];
}

export function senateProb(abbr: string): number | undefined {
  return SENATE_PROB_DEM[abbr];
}

export function governorProb(abbr: string): number | undefined {
  return GOV_PROB_DEM[abbr];
}

/** Aggregate stats assuming independence. We'll do a proper Monte Carlo later. */
export function aggregateHouse(): { expectedD: number; expectedR: number; total: number } {
  let expectedD = 0;
  const probs = Object.values(DISTRICT_PROB_DEM);
  for (const p of probs) expectedD += p;
  return {
    expectedD: Math.round(expectedD * 10) / 10,
    expectedR: Math.round((probs.length - expectedD) * 10) / 10,
    total: probs.length,
  };
}

export function aggregateSenate(): {
  expectedDPickups: number;
  upForElection: number;
  /** Dems hold 47 + 4 indies caucusing D = 51 currently; only ~33 Class-2 seats up. */
  baseSeats: { D: number; R: number };
} {
  // Base = seats NOT up in 2026 (Class 1 + Class 3 holding through 2028 + 2030).
  // Approx: D-caucus 31, R 35 (varies by year; placeholder).
  let expected = 0;
  for (const p of Object.values(SENATE_PROB_DEM)) expected += p;
  return {
    expectedDPickups: Math.round(expected * 10) / 10,
    upForElection: SENATE_2026_STATES.size,
    baseSeats: { D: 32, R: 35 },
  };
}

export function aggregateGovernor(): { expectedD: number; expectedR: number; total: number } {
  let expectedD = 0;
  const probs = Object.values(GOV_PROB_DEM);
  for (const p of probs) expectedD += p;
  return {
    expectedD: Math.round(expectedD * 10) / 10,
    expectedR: Math.round((probs.length - expectedD) * 10) / 10,
    total: probs.length,
  };
}

/** State-level House summary: number of D-leading districts in each state. */
export function houseByState(stateFips: string): { dLead: number; rLead: number; total: number } {
  let dLead = 0;
  let total = 0;
  const meta = STATES_BY_FIPS[stateFips];
  if (!meta) return { dLead: 0, rLead: 0, total: 0 };
  for (let d = 1; d <= meta.districts; d++) {
    const cd = meta.districts === 1 ? "00" : String(d).padStart(2, "0");
    const p = DISTRICT_PROB_DEM[stateFips + cd];
    if (p === undefined) continue;
    total++;
    if (p >= 0.5) dLead++;
  }
  return { dLead, rLead: total - dLead, total };
}
