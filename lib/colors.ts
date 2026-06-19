export type Party = "D" | "R" | "I" | "T";

export const PARTY_CSS_VAR: Record<Party, string> = {
  D: "var(--color-dem)",
  R: "var(--color-rep)",
  I: "var(--color-ind)",
  T: "var(--color-tossup)",
};

export const PARTY_LABEL: Record<Party, string> = {
  D: "Democratic",
  R: "Republican",
  I: "Independent",
  T: "Toss-up",
};

/**
 * Color a race by the leading party + confidence (0..1).
 * Saturation curve: confidence < 0.55 -> mostly paper (toss-up tint),
 * confidence -> 1 -> deep party color.
 */
export function tintByOdds(party: Party, confidence: number): string {
  const c = Math.max(0, Math.min(1, confidence));
  // Map [0.5, 1] confidence -> [0, 1] saturation; below 0.5 we render as toss-up.
  const sat = Math.max(0, (c - 0.5) * 2);
  const pct = Math.round(Math.pow(sat, 1.4) * 70 + 8);
  const tone = PARTY_CSS_VAR[party];
  return `color-mix(in oklab, ${tone} ${pct}%, var(--color-paper))`;
}

/** Darker variant of party color, for borders / labels. */
export function partyInk(party: Party): string {
  return PARTY_CSS_VAR[party];
}

/** Probability the leading party wins, given prob_dem in [0, 1].
 *  Confidence is reported as `1 - probDem` for the R case, which is only
 *  correct when there are no independents. Prefer `leadingFromProbs`. */
export function leadingFromProbDem(probDem: number): { party: Party; confidence: number } {
  if (probDem >= 0.5) return { party: "D", confidence: probDem };
  return { party: "R", confidence: 1 - probDem };
}

/**
 * Which party is leading, given raw P(D wins) and P(R wins). With an
 * independent on the ballot, `probDem + probRep` can fall well below 1,
 * and the residual is P(indie wins). Confidence is the leader's own
 * probability (not `1 - the other side`), so Nebraska reads as "R 65%",
 * not "R 99%".
 */
export function leadingFromProbs(
  probDem: number,
  probRep: number,
): { party: Party; confidence: number } {
  const probInd = Math.max(0, 1 - probDem - probRep);
  if (probInd > probDem && probInd > probRep) {
    return { party: "I", confidence: probInd };
  }
  if (probDem >= probRep) return { party: "D", confidence: probDem };
  return { party: "R", confidence: probRep };
}
