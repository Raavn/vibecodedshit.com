import { describe, expect, it } from 'vitest';
import type { UnitRaw } from '../measure/types.js';
import { loadMethodology } from '../methodology/load.js';
import { bandFor, dimensionScore, effectiveWeights, healthScore, roundHalfUp } from './aggregate.js';
import { poolParameter } from './pool.js';
import { scoreRaw } from './score.js';

// Weights and anchors come from the real YAML. Only the raw inputs are
// transcribed from METHODOLOGY.md section 2.
const methodology = loadMethodology('1.0');
const defs = new Map(methodology.dimensions.flatMap((d) => d.parameters).map((p) => [p.id, p]));
const def = (id: string) => {
  const found = defs.get(id);
  if (!found) throw new Error(`no parameter ${id}`);
  return found;
};
const dimension = (id: number) => {
  const found = methodology.dimensions.find((d) => d.id === id);
  if (!found) throw new Error(`no dimension ${id}`);
  return found;
};
const ratio = (value: number) => ({ kind: 'ratio' as const, numerator: value, denominator: 100, scale: 100 });

describe('parameter score', () => {
  it('scores 52% line coverage as 65', () => {
    expect(scoreRaw(def('1.2'), ratio(52))).toBeCloseTo(65, 6);
  });

  it('clamps outside the anchors', () => {
    expect(scoreRaw(def('1.2'), ratio(0))).toBe(0);
    expect(scoreRaw(def('1.2'), ratio(100))).toBe(100);
  });

  it('scores a ratio with nothing to count as when_empty', () => {
    expect(scoreRaw(def('4.2'), { kind: 'ratio', numerator: 0, denominator: 0, scale: 100 })).toBe(100);
    expect(scoreRaw(def('1.2'), { kind: 'ratio', numerator: 0, denominator: 0, scale: 100 })).toBe(0);
  });

  it('scores a component ratio with nothing to count as its own emptyScore, else when_empty (6.5)', () => {
    const runtime = { kind: 'level' as const, level: 'no' };
    const empty = { kind: 'ratio' as const, numerator: 0, denominator: 0, scale: 100 };
    // runtime_pinned 0, env_documented 100 (no variables read): mean 50.
    expect(scoreRaw(def('6.5'), { kind: 'components', components: { runtime_pinned: runtime, env_documented: { ...empty, emptyScore: 100 } } })).toBe(50);
    // Without emptyScore the parameter's when_empty (0) applies.
    expect(scoreRaw(def('6.5'), { kind: 'components', components: { runtime_pinned: runtime, env_documented: empty } })).toBe(0);
    expect(scoreRaw(def('6.5'), { kind: 'components', components: { runtime_pinned: { kind: 'level', level: 'yes' }, env_documented: { kind: 'ratio', numerator: 3, denominator: 5, scale: 100 } } })).toBe(80);
  });

  it('scores levels, including the language-group form of 2.2', () => {
    expect(scoreRaw(def('2.2'), { kind: 'level', level: 'strict_plus' }, 'typescript_javascript')).toBe(100);
    expect(scoreRaw(def('2.2'), { kind: 'level', level: 'standard' }, 'python')).toBe(75);
    expect(scoreRaw(def('3.1'), { kind: 'level', level: 'declared' })).toBe(50);
  });
});

describe('dimension score', () => {
  it('reproduces the D1 example (65)', () => {
    const raws: Record<string, number> = { '1.1': 97, '1.2': 52, '1.3': 38, '1.4': 55, '1.5': 92 };
    const params = dimension(1).parameters.map((p) => ({
      weight: p.weight,
      score: scoreRaw(p, ratio(raws[p.id] ?? 0)),
    }));
    expect(params.map((p) => p.score)).toEqual([70, 65, 60, 62.5, 70].map((s) => expect.closeTo(s, 6)));
    expect(roundHalfUp(dimensionScore(params) ?? NaN)).toBe(65);
  });

  it('redistributes the weight of a not-applicable parameter (D3 without 3.5)', () => {
    const params = dimension(3).parameters.map((p) => ({ weight: p.weight, score: p.id === '3.5' ? null : 50 }));
    const weights = effectiveWeights(params).map((w) => Math.round(w * 10) / 10);
    expect(weights).toEqual([17.6, 35.3, 29.4, 17.6, 0]);
  });

  it('has no score when no parameter is measured', () => {
    expect(dimensionScore([{ weight: 100, score: null }])).toBeNull();
  });
});

describe('health score', () => {
  const cap = methodology.capMargin;
  const health = (scores: number[]) => healthScore(scores, cap) ?? NaN;

  it('gives 71 (Stable) for the balanced example', () => {
    const displayed = roundHalfUp(health([72, 65, 58, 81, 90, 60]));
    expect(displayed).toBe(71);
    expect(bandFor(displayed, methodology.bands).name).toBe('Stable');
  });

  it('gives 35 (Vibe-coded) for the no-tests example', () => {
    const displayed = roundHalfUp(health([5, 80, 80, 80, 80, 80]));
    expect(displayed).toBe(35);
    expect(bandFor(displayed, methodology.bands).name).toBe('Vibe-coded');
  });

  it('rounds half up and takes the band from the displayed value', () => {
    expect(roundHalfUp(59.5)).toBe(60);
    expect(bandFor(60, methodology.bands).key).toBe('stable');
    expect(bandFor(59, methodology.bands).key).toBe('fragile');
  });

  it('is computed over the scored dimensions only', () => {
    expect(healthScore([69.5, null, 80], cap)).toBeCloseTo(74.75, 6);
    expect(healthScore([null, null], cap)).toBeNull();
  });
});

describe('pooling', () => {
  it('pools 2.2 to 80 for 8,000 TypeScript lines at 100 and 2,000 Python lines at 0', () => {
    const units: UnitRaw[] = [
      { package: '.', group: 'typescript_javascript', weight: 8000, raw: { kind: 'level', level: 'strict_plus' } },
      { package: '.', group: 'python', weight: 2000, raw: { kind: 'level', level: 'none' } },
    ];
    expect(poolParameter(def('2.2'), units).score).toBeCloseTo(80, 6);
  });

  it('sums numerators and denominators for ratio parameters', () => {
    const units: UnitRaw[] = [
      { package: 'a', group: 'typescript_javascript', weight: 100, raw: { kind: 'ratio', numerator: 100, denominator: 100, scale: 100 } },
      { package: 'b', group: 'python', weight: 900, raw: { kind: 'ratio', numerator: 0, denominator: 900, scale: 100 } },
    ];
    const pooled = poolParameter(def('4.2'), units);
    expect(pooled.raw).toEqual({ kind: 'ratio', numerator: 100, denominator: 1000, scale: 100 });
    expect(pooled.score).toBeCloseTo(75, 6); // 10% is the 75 anchor
  });
});
