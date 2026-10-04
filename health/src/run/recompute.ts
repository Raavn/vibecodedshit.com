import type { Methodology } from '../methodology/load.js';
import { poolParameter } from '../scoring/pool.js';
import type { RunDimension, RunFile, RunParameter } from './schema.js';
import { dimensionScores, healthFrom } from './score-run.js';

export interface Recomputed {
  parameters: RunParameter[];
  dimensions: RunDimension[];
  health: RunFile['health'];
}

/** Re-derive every score from the stored raw values. */
export function recompute(run: RunFile, methodology: Methodology): Recomputed {
  const defs = new Map(methodology.dimensions.flatMap((d) => d.parameters).map((p) => [p.id, p]));
  const parameters = run.parameters.map((param): RunParameter => {
    const def = defs.get(param.id);
    if (!def) throw new Error(`run.json names unknown parameter ${param.id}`);
    if (param.status === 'failed') return { ...param, score: 0 };
    if (param.status !== 'measured') return param;
    const pooled = poolParameter(def, param.units ?? []);
    return { ...param, raw: pooled.raw, score: pooled.score, units: pooled.units };
  });
  const dimensions = dimensionScores(methodology, parameters);
  return { parameters, dimensions, health: healthFrom(methodology, dimensions) };
}
