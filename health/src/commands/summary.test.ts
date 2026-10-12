import { describe, expect, it } from 'vitest';
import type { RunParameter, RunUnit } from '../run/schema.js';
import { formatRaw, shownRaw } from './summary.js';

function unit(pkg: string, raw: RunUnit['raw']): RunUnit {
  return { package: pkg, group: 'typescript_javascript', weight: 1, raw, score: 0 };
}

function param(raw: RunParameter['raw'], units: RunUnit[] = []): RunParameter {
  return { id: '9.9', status: 'measured', weight: 1, raw, score: 0, units };
}

describe('scan summary raw values', () => {
  it('prints a scale-100 ratio as a percentage', () => {
    expect(shownRaw(param({ kind: 'ratio', numerator: 8, denominator: 21, scale: 100 }), 'percent')).toBe('38.1%');
  });

  it('prints a scale-1000 ratio per 1,000 with the YAML unit', () => {
    // laya-server 2.1: 6 errors in 357 source lines.
    expect(shownRaw(param({ kind: 'ratio', numerator: 6, denominator: 357, scale: 1000 }), 'errors per 1,000 source lines')).toBe(
      '16.8 errors per 1,000 source lines',
    );
  });

  it('prints the one unit value when the top-level raw is null', () => {
    expect(shownRaw(param(null, [unit('.', { kind: 'number', value: 3.1 })]), 'seconds')).toBe('3.1 seconds');
    expect(shownRaw(param(null, [unit('.', { kind: 'number', value: 0 })]), 'count')).toBe('0');
    expect(shownRaw(param({ kind: 'number', value: 178 }), 'severity points')).toBe('178 severity points');
  });

  it('labels each unit when there are several', () => {
    const units = [unit('web', { kind: 'number', value: 2 }), { ...unit('api', { kind: 'number', value: 1.25 }), group: 'python' as const }];
    expect(shownRaw(param(null, units), 'seconds')).toBe('web/typescript_javascript: 2 seconds; api/python: 1.3 seconds');
  });

  it('prints components as name=value pairs', () => {
    const raw = {
      kind: 'components' as const,
      components: {
        runtime_pinned: { kind: 'level' as const, level: 'yes' },
        env_documented: { kind: 'ratio' as const, numerator: 1, denominator: 4, scale: 100 },
      },
    };
    expect(shownRaw(param(null, [unit('.', raw)]), 'score')).toBe('runtime_pinned=yes, env_documented=25.0%');
  });

  it('prints n/a only when there is no raw value anywhere', () => {
    expect(shownRaw(param(null, []), 'percent')).toBe('n/a');
    expect(shownRaw(param({ kind: 'ratio', numerator: 0, denominator: 0, scale: 100 }), 'percent')).toBe('n/a');
    expect(formatRaw({ kind: 'ratio', numerator: 0, denominator: 0, scale: 1000 }, 'violations per 1,000 imports')).toBeNull();
  });

  it('keeps the distinct levels for level raws', () => {
    expect(shownRaw(param(null, [unit('a', { kind: 'level', level: 'strict' }), unit('b', { kind: 'level', level: 'strict' })]), 'level')).toBe('strict');
  });
});
