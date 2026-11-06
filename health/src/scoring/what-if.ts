import type { Methodology } from '../methodology/load.js';
import type { ParameterDef } from '../methodology/schema.js';
import type { RunFile, RunParameter } from '../run/schema.js';
import { dimensionScore, healthScore, type WeightedScore } from './aggregate.js';

/** Parameter id to a score it is assumed to have instead of its stored one. */
export type ScoreOverrides = ReadonlyMap<string, number>;

function weighted(def: ParameterDef, param: RunParameter | undefined, overrides: ScoreOverrides): WeightedScore {
  const override = overrides.get(def.id);
  if (override !== undefined) return { weight: def.weight, score: override };
  if (param?.status === 'failed') return { weight: def.weight, score: 0 };
  if (param?.status === 'measured') return { weight: def.weight, score: param.score ?? 0 };
  return { weight: def.weight, score: null };
}

/** The unrounded health and dimension scores if the overridden parameters had the given scores. Reads the stored parameters only. */
export function healthWith(run: RunFile, methodology: Methodology, overrides: ScoreOverrides): { health: number | null; dimension: Map<number, number | null> } {
  const dimension = new Map<number, number | null>();
  for (const dim of methodology.dimensions) {
    dimension.set(dim.id, dimensionScore(dim.parameters.map((def) => weighted(def, run.parameters.find((p) => p.id === def.id), overrides))));
  }
  return { health: healthScore([...dimension.values()], methodology.capMargin), dimension };
}

export interface Candidate {
  score: number;
  descriptor: string;
}

/** The lowest-scoring anchor or level above `score` that has a descriptor. Null when there is none or the parameter has no descriptors. */
export function nextCandidate(def: ParameterDef, score: number): Candidate | null {
  const scoring = def.scoring;
  let candidates: { score: number; descriptor?: string | undefined }[];
  if (scoring.method === 'piecewise_linear') candidates = scoring.anchors;
  else if (scoring.method === 'levels') candidates = Array.isArray(scoring.levels) ? scoring.levels : Object.values(scoring.levels).flat();
  else return null;
  let best: { score: number; descriptor: string } | undefined;
  for (const candidate of candidates) {
    if (!candidate.descriptor || candidate.score <= score + 1e-9) continue;
    if (!best || candidate.score < best.score) best = { score: candidate.score, descriptor: candidate.descriptor };
  }
  return best ? { score: best.score, descriptor: best.descriptor.replace(/\s+/g, ' ').trim() } : null;
}
