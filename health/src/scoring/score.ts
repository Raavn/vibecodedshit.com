import type { Raw } from '../measure/types.js';
import type { LevelEntry, ParameterDef } from '../methodology/schema.js';
import type { Group } from '../scope/types.js';

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** The numeric value of a ratio or number raw. A ratio with no denominator has no value. */
export function rawValue(raw: Raw): number | null {
  if (raw.kind === 'number') return raw.value;
  if (raw.kind === 'ratio') {
    return raw.denominator === 0 ? null : (raw.numerator / raw.denominator) * raw.scale;
  }
  throw new Error(`Raw of kind ${raw.kind} has no numeric value`);
}

export function piecewiseLinear(anchors: { raw: number; score: number }[], value: number): number {
  const sorted = [...anchors].sort((a, b) => a.raw - b.raw);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) throw new Error('piecewise_linear needs anchors');
  if (value <= first.raw) return first.score;
  if (value >= last.raw) return last.score;
  for (let i = 1; i < sorted.length; i += 1) {
    const lo = sorted[i - 1];
    const hi = sorted[i];
    if (lo && hi && value <= hi.raw) {
      return lo.score + ((value - lo.raw) / (hi.raw - lo.raw)) * (hi.score - lo.score);
    }
  }
  return last.score;
}

function levelScore(levels: LevelEntry[], level: string): number {
  const found = levels.find((entry) => entry.level === level);
  if (!found) throw new Error(`Unknown level "${level}"`);
  return found.score;
}

/** Score one raw value. A ratio with no denominator scores `raw.when_empty`. */
export function scoreRaw(def: ParameterDef, raw: Raw, group?: Group): number {
  const scoring = def.scoring;
  switch (scoring.method) {
    case 'piecewise_linear': {
      const value = rawValue(raw);
      return value === null ? def.raw.when_empty : piecewiseLinear(scoring.anchors, value);
    }
    case 'levels': {
      if (raw.kind !== 'level') throw new Error(`${def.id}: levels scoring needs a level raw`);
      if (Array.isArray(scoring.levels)) return levelScore(scoring.levels, raw.level);
      if (!group) throw new Error(`${def.id}: a language group is needed to score this level`);
      const forGroup = scoring.levels[group];
      if (!forGroup) throw new Error(`${def.id}: no levels for group ${group}`);
      return levelScore(forGroup, raw.level);
    }
    case 'mean_of_components': {
      if (raw.kind !== 'components') throw new Error(`${def.id}: needs a components raw`);
      const scores = scoring.components.map((component) => {
        const part = raw.components[component.key];
        if (!part) throw new Error(`${def.id}: missing component ${component.key}`);
        if (component.method === 'levels') {
          if (part.kind !== 'level' || !component.levels) {
            throw new Error(`${def.id}.${component.key}: needs a level raw`);
          }
          return levelScore(component.levels, part.level);
        }
        const value = rawValue(part);
        return value === null ? def.raw.when_empty : clamp(value, 0, 100);
      });
      return scores.reduce((sum, s) => sum + s, 0) / scores.length;
    }
  }
}
