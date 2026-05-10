/**
 * Poisson-binomial PMF: probability of exactly k successes
 * given n independent Bernoulli trials with success probabilities `probs`.
 *
 * Returns an array of length n+1, indexed by number of successes.
 */
export function poissonBinomialPMF(probs: number[]): number[] {
  const n = probs.length;
  let dist = new Float64Array(n + 1);
  dist[0] = 1;
  for (let i = 0; i < n; i++) {
    const p = probs[i];
    const next = new Float64Array(n + 1);
    for (let k = 0; k <= i + 1; k++) {
      const a = k > 0 ? dist[k - 1] * p : 0;
      const b = k <= i ? dist[k] * (1 - p) : 0;
      next[k] = a + b;
    }
    dist = next;
  }
  return Array.from(dist);
}

/** Mean and stdev of the seat count, plus quantile lookup. */
export function distSummary(pmf: number[]): {
  mean: number;
  std: number;
  /** Smallest k with cumulative P >= q. */
  quantile: (q: number) => number;
} {
  let mean = 0;
  for (let k = 0; k < pmf.length; k++) mean += k * pmf[k];
  let variance = 0;
  for (let k = 0; k < pmf.length; k++) variance += pmf[k] * (k - mean) ** 2;
  const cum = new Float64Array(pmf.length);
  let s = 0;
  for (let k = 0; k < pmf.length; k++) {
    s += pmf[k];
    cum[k] = s;
  }
  const quantile = (q: number) => {
    for (let k = 0; k < cum.length; k++) if (cum[k] >= q) return k;
    return cum.length - 1;
  };
  return { mean, std: Math.sqrt(variance), quantile };
}

export type Bucket =
  | "safe-d"
  | "likely-d"
  | "lean-d"
  | "tossup"
  | "lean-r"
  | "likely-r"
  | "safe-r";

export const BUCKET_ORDER: Bucket[] = [
  "safe-d",
  "likely-d",
  "lean-d",
  "tossup",
  "lean-r",
  "likely-r",
  "safe-r",
];

export const BUCKET_LABEL: Record<Bucket, string> = {
  "safe-d": "Safe D",
  "likely-d": "Likely D",
  "lean-d": "Lean D",
  tossup: "Tossup",
  "lean-r": "Lean R",
  "likely-r": "Likely R",
  "safe-r": "Safe R",
};

/** Cook-style ratings cut on P(Democrat wins). */
export function bucketOf(probDem: number): Bucket {
  if (probDem >= 0.95) return "safe-d";
  if (probDem >= 0.8) return "likely-d";
  if (probDem >= 0.6) return "lean-d";
  if (probDem > 0.4) return "tossup";
  if (probDem > 0.2) return "lean-r";
  if (probDem > 0.05) return "likely-r";
  return "safe-r";
}

export function bucketCounts(probs: number[]): Record<Bucket, number> {
  const out: Record<Bucket, number> = {
    "safe-d": 0,
    "likely-d": 0,
    "lean-d": 0,
    tossup: 0,
    "lean-r": 0,
    "likely-r": 0,
    "safe-r": 0,
  };
  for (const p of probs) out[bucketOf(p)]++;
  return out;
}

export const BUCKET_COLOR_VAR: Record<Bucket, string> = {
  "safe-d": "var(--color-dem)",
  "likely-d": "color-mix(in oklab, var(--color-dem) 65%, var(--color-paper))",
  "lean-d": "color-mix(in oklab, var(--color-dem) 30%, var(--color-paper))",
  tossup: "var(--color-tossup)",
  "lean-r": "color-mix(in oklab, var(--color-rep) 30%, var(--color-paper))",
  "likely-r": "color-mix(in oklab, var(--color-rep) 65%, var(--color-paper))",
  "safe-r": "var(--color-rep)",
};
