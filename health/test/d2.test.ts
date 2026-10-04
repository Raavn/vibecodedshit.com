import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { p22 } from '../src/measure/p2-2.js';
import { p23 } from '../src/measure/p2-3.js';
import { p24 } from '../src/measure/p2-4.js';
import type { Measurement, Measurer } from '../src/measure/types.js';
import { loadMethodology } from '../src/methodology/load.js';
import { poolParameter } from '../src/scoring/pool.js';
import { buildScope } from '../src/scope/build.js';
import { fixturesDir, materializeFixture } from './helpers/fixture.js';
import { fakeToolKit } from './helpers/tools.js';

const methodology = loadMethodology('1.0');

const expected = (name: string): Record<string, never> =>
  JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Record<string, never>;

async function run(fixture: string, measurer: Measurer, id: string, repoPath = materializeFixture(fixture)) {
  const param = methodology.dimensions.flatMap((d) => d.parameters).find((p) => p.id === id);
  if (!param) throw new Error(`no parameter ${id}`);
  const scope = await buildScope(repoPath, methodology);
  const measurement: Measurement = await measurer.measure({
    methodology,
    param,
    scope,
    repoPath,
    asOf: '2026-10-04',
    mode: 'preview',
    tools: fakeToolKit(),
  });
  if (measurement.status !== 'measured') throw new Error(`${id}: ${measurement.status}`);
  return { measurement, pooled: poolParameter(param, measurement.units) };
}

const name = (pkg: string): string => pkg.split('/').pop() ?? pkg;

describe('2.2 declared strictness', () => {
  it('reads every TypeScript level, extends chains, jsconfig, solution-style configs and inherited configs', async () => {
    const want = expected('d2-levels-ts') as never as { levels: Record<string, string>; score: number };
    const { measurement, pooled } = await run('d2-levels-ts', p22, '2.2');
    const levels = Object.fromEntries(
      measurement.status === 'measured'
        ? measurement.units.map((u) => [name(u.package), u.raw.kind === 'level' ? u.raw.level : u.raw.kind])
        : [],
    );
    expect(levels).toEqual(want.levels);
    expect(pooled.score).toBeCloseTo(want.score, 3);
  });

  it('reads every Python level: pyright, basedpyright, mypy in four file kinds, precedence and inheritance', async () => {
    const want = expected('d2-levels-py') as never as { levels: Record<string, string>; score: number };
    const { measurement, pooled } = await run('d2-levels-py', p22, '2.2');
    const levels = Object.fromEntries(
      measurement.status === 'measured'
        ? measurement.units.map((u) => [name(u.package), u.raw.kind === 'level' ? u.raw.level : u.raw.kind])
        : [],
    );
    expect(levels).toEqual(want.levels);
    expect(pooled.score).toBeCloseTo(want.score, 3);
  });

  it('warns when an extends target cannot be resolved and computes the level without it', async () => {
    const repo = materializeFixture('d2-levels-ts', {}, {
      'packages/strict/tsconfig.json': JSON.stringify({ extends: 'missing-base-package/tsconfig.json', compilerOptions: { strict: true } }),
    });
    const { measurement } = await run('d2-levels-ts', p22, '2.2', repo);
    const strict = measurement.status === 'measured' ? measurement.units.find((u) => name(u.package) === 'strict') : undefined;
    expect(strict?.raw).toEqual({ kind: 'level', level: 'strict' });
    expect(measurement.status === 'measured' ? measurement.warnings : []).toContain(
      '2.2: packages/strict/tsconfig.json extends missing-base-package/tsconfig.json, which could not be resolved; level computed without it',
    );
  });

  it('ignores an invalid pyproject.toml with a warning', async () => {
    const repo = materializeFixture('d2-levels-py', {}, { 'packages/noconfig/pyproject.toml': '[project\nname = ' });
    const { measurement } = await run('d2-levels-py', p22, '2.2', repo);
    expect(measurement.status === 'measured' ? measurement.warnings : []).toContain('2.2: packages/noconfig/pyproject.toml: invalid TOML, ignored');
  });
});

describe('2.3 escape hatches', () => {
  it('counts each TypeScript and JavaScript hatch once and file-level opt-outs as 10', async () => {
    const want = expected('d2-escape-ts') as never as { ts: Record<string, number> };
    const { measurement } = await run('d2-escape-ts', p23, '2.3');
    expect(measurement.status === 'measured' ? measurement.units.map((u) => u.raw) : []).toEqual([{ kind: 'ratio', ...want.ts }]);
  });

  it('counts each Python hatch once, resolves Any through imports and counts file-level opt-outs as 10', async () => {
    const want = expected('d2-escape-py') as never as { py: Record<string, number> };
    const { measurement } = await run('d2-escape-py', p23, '2.3');
    expect(measurement.status === 'measured' ? measurement.units.map((u) => u.raw) : []).toEqual([{ kind: 'ratio', ...want.py }]);
  });

  it('skips Python files that do not parse and warns once', async () => {
    const repo = materializeFixture('d2-escape-py', {}, { 'broken.py': 'def broken(:\n    pass\n' });
    const { measurement } = await run('d2-escape-py', p23, '2.3', repo);
    expect(measurement.status === 'measured' ? measurement.warnings : []).toEqual(['2.3/2.4: 1 Python files could not be parsed']);
  });
});

describe('2.4 typed public surface', () => {
  it('counts typed and total parameters on the TypeScript and JavaScript public surface', async () => {
    const want = expected('d2-surface-ts') as never as Record<string, { numerator: number; denominator: number }>;
    const { measurement } = await run('d2-surface-ts', p24, '2.4');
    const slots = Object.fromEntries(
      measurement.status === 'measured'
        ? measurement.units.map((u) => [name(u.package), u.raw.kind === 'ratio' ? { numerator: u.raw.numerator, denominator: u.raw.denominator } : null])
        : [],
    );
    expect(slots).toEqual({ ts: want.ts, jscheck: want.jscheck, jsplain: want.jsplain, cjs: want.cjs });
  });

  it('counts typed and total parameters and return types on the Python public surface', async () => {
    const want = expected('d2-surface-py') as never as { api: { numerator: number; denominator: number } };
    const { measurement } = await run('d2-surface-py', p24, '2.4');
    expect(measurement.status === 'measured' ? measurement.units.map((u) => u.raw) : []).toEqual([{ kind: 'ratio', ...want.api, scale: 100 }]);
  });
});
