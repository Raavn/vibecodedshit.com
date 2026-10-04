import type { Raw } from '../measure/types.js';
import type { ParameterDef } from '../methodology/schema.js';
import { roundHalfUp } from '../scoring/aggregate.js';
import type { RunParameter } from '../run/schema.js';

function round1(value: number): string {
  return roundHalfUp(value, 1).toFixed(1);
}

function scaleLabel(scale: number): string {
  if (scale === 100) return '%';
  if (scale === 1000) return ' per 1,000';
  return ` per ${scale}`;
}

function formatRaw(raw: Raw, unit: string): string {
  switch (raw.kind) {
    case 'ratio':
      return raw.denominator === 0
        ? `${raw.numerator} / 0`
        : `${raw.numerator} / ${raw.denominator} (${round1((raw.numerator / raw.denominator) * raw.scale)}${scaleLabel(raw.scale)})`;
    case 'level':
      return raw.level;
    case 'number':
      return `${raw.value} ${unit}`;
    case 'components':
      return Object.entries(raw.components)
        .map(([key, part]) => `${key}: ${formatRaw(part, unit)}`)
        .join('; ');
  }
}

/** The raw value as the report prints it. Level parameters have no pooled raw, so their units' levels are listed. */
export function rawText(param: RunParameter, def: ParameterDef): string {
  if (param.raw) return formatRaw(param.raw, def.raw.unit);
  const levels = [...new Set((param.units ?? []).flatMap((u) => (u.raw.kind === 'level' ? [u.raw.level] : [])))];
  if (levels.length > 0) return levels.join(', ');
  const components = (param.units ?? []).flatMap((u) => (u.raw.kind === 'components' ? [u.raw] : []));
  if (components.length > 0) return components.map((c) => formatRaw(c, def.raw.unit)).join(' | ');
  return 'no data';
}

/**
 * The descriptor of the anchor or level whose score is closest to the parameter's score, ties to the lower score.
 * Null for parameters without descriptors (components).
 */
export function nearestDescriptor(def: ParameterDef, score: number): string | null {
  const scoring = def.scoring;
  let candidates: { score: number; descriptor?: string | undefined }[];
  if (scoring.method === 'piecewise_linear') candidates = scoring.anchors;
  else if (scoring.method === 'levels') candidates = Array.isArray(scoring.levels) ? scoring.levels : Object.values(scoring.levels).flat();
  else return null;
  let best: { score: number; descriptor?: string | undefined } | undefined;
  for (const candidate of candidates) {
    if (!candidate.descriptor) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const gap = Math.abs(candidate.score - score);
    const bestGap = Math.abs(best.score - score);
    if (gap < bestGap - 1e-9 || (Math.abs(gap - bestGap) <= 1e-9 && candidate.score < best.score)) best = candidate;
  }
  return best?.descriptor?.replace(/\s+/g, ' ').trim() ?? null;
}

export function statusText(status: RunParameter['status']): string {
  return status.replace('_', ' ');
}

export function scoreText(score: number | null | undefined): string {
  return score === null || score === undefined ? '–' : String(roundHalfUp(score));
}
