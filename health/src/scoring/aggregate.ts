import type { BandDef } from '../methodology/schema.js';

export interface WeightedScore {
  weight: number;
  /** Null when the parameter is not applicable or not measured. */
  score: number | null;
}

/** Weights after not-applicable and not-measured weight is spread in proportion. Null-score entries get 0. */
export function effectiveWeights(params: WeightedScore[]): number[] {
  const live = params.reduce((sum, p) => (p.score === null ? sum : sum + p.weight), 0);
  const total = params.reduce((sum, p) => sum + p.weight, 0);
  return params.map((p) => (p.score === null || live === 0 ? 0 : (p.weight / live) * total));
}

/** Weighted mean of the scored parameters. Null when none is scored. */
export function dimensionScore(params: WeightedScore[]): number | null {
  let weighted = 0;
  let weights = 0;
  for (const p of params) {
    if (p.score === null) continue;
    weighted += p.score * p.weight;
    weights += p.weight;
  }
  return weights === 0 ? null : weighted / weights;
}

/** health = min(mean, min + capMargin) over the scored dimensions. Null when none is scored. */
export function healthScore(dimensionScores: (number | null)[], capMargin: number): number | null {
  const scores = dimensionScores.filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return Math.min(mean, Math.min(...scores) + capMargin);
}

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5 + 1e-9);
}

export function bandFor(displayedHealth: number, bands: BandDef[]): BandDef {
  const band = bands.find((b) => displayedHealth >= b.min && displayedHealth <= b.max);
  if (!band) throw new Error(`No band for health ${displayedHealth}`);
  return band;
}
