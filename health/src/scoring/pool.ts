import type { Raw, UnitRaw } from '../measure/types.js';
import type { ParameterDef } from '../methodology/schema.js';
import { scoreRaw } from './score.js';

export interface ScoredUnit extends UnitRaw {
  score: number;
}

export interface PooledParameter {
  /** Pooled raw value. Null when a ratio has nothing to count. */
  raw: Raw | null;
  score: number;
  units: ScoredUnit[];
}

/**
 * Combine the units of one parameter into one raw value and score.
 * ratio: sum numerators and denominators, score once.
 * unit_weighted: score each unit, combine by weight.
 */
export function poolParameter(def: ParameterDef, units: UnitRaw[]): PooledParameter {
  const scored: ScoredUnit[] = units.map((unit) => ({
    ...unit,
    score: scoreRaw(def, unit.raw, unit.group),
  }));

  if (def.pooling === 'ratio') {
    let numerator = 0;
    let denominator = 0;
    let scale: number | null = null;
    let summed: number | null = null;
    for (const unit of units) {
      // number raws (5.1 severity points) are summed, their denominator is ignored.
      if (unit.raw.kind === 'number') {
        summed = (summed ?? 0) + unit.raw.value;
        continue;
      }
      if (unit.raw.kind !== 'ratio') throw new Error(`${def.id}: ratio pooling needs ratio raws`);
      if (scale !== null && scale !== unit.raw.scale) {
        throw new Error(`${def.id}: units disagree on ratio scale`);
      }
      scale = unit.raw.scale;
      numerator += unit.raw.numerator;
      denominator += unit.raw.denominator;
    }
    if (summed !== null) {
      if (scale !== null) throw new Error(`${def.id}: ratio pooling cannot mix number and ratio raws`);
      const raw: Raw = { kind: 'number', value: summed };
      return { raw, score: scoreRaw(def, raw), units: scored };
    }
    if (scale === null || denominator === 0) {
      return { raw: null, score: def.raw.when_empty, units: scored };
    }
    const raw: Raw = { kind: 'ratio', numerator, denominator, scale };
    return { raw, score: scoreRaw(def, raw), units: scored };
  }

  const totalWeight = scored.reduce((sum, unit) => sum + unit.weight, 0);
  if (totalWeight === 0) return { raw: null, score: def.raw.when_empty, units: scored };
  const score = scored.reduce((sum, unit) => sum + unit.score * unit.weight, 0) / totalWeight;
  return { raw: null, score, units: scored };
}
