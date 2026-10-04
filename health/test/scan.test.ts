import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { loadMethodology } from '../src/methodology/load.js';
import { recompute } from '../src/run/recompute.js';
import type { RunFile } from '../src/run/schema.js';
import { runScan } from '../src/run/scan.js';
import { buildScope } from '../src/scope/build.js';
import { fixturesDir, materializeFixture } from './helpers/fixture.js';
import { fakeToolKit } from './helpers/tools.js';

const methodology = loadMethodology('1.0');
// A fresh kit per scan (the kit memoizes). No Python tool is installed in these tests, so they do not depend on the host.
const scanOpts = (repoPath: string) => ({ repoPath, methodologyVersion: '1.0', mode: 'preview' as const, asOf: '2026-10-04', tools: fakeToolKit() });

interface Expected {
  logicFiles: number;
  logicLines: number;
  sourceLines: number;
  packages?: string[];
  p42: { numerator: number; denominator: number; rawPercent: number; score: number };
  units?: { package: string; group: string; numerator: number; denominator: number }[];
}
const expected = (name: string): Expected =>
  JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Expected;

function p42(runFile: RunFile) {
  const param = runFile.parameters.find((p) => p.id === '4.2');
  if (!param) throw new Error('no 4.2');
  return param;
}

describe.each(['typescript', 'python', 'monorepo'])('fixture %s', (name) => {
  const want = expected(name);

  it('counts the hand-counted lines', async () => {
    const scope = await buildScope(materializeFixture(name), methodology);
    expect(scope.logicFiles).toBe(want.logicFiles);
    expect(scope.logicLines).toBe(want.logicLines);
    expect(scope.sourceLines).toBe(want.sourceLines);
    if (want.packages) expect(scope.packages).toEqual(want.packages);
  });

  it('reproduces the hand-counted 4.2 raw value and score', async () => {
    const result = await runScan(scanOpts(materializeFixture(name)));
    const param = p42(result);
    expect(param.status).toBe('measured');
    expect(param.raw).toEqual({
      kind: 'ratio',
      numerator: want.p42.numerator,
      denominator: want.p42.denominator,
      scale: 100,
    });
    const raw = param.raw;
    if (raw?.kind !== 'ratio') throw new Error('not a ratio');
    expect((raw.numerator / raw.denominator) * 100).toBeCloseTo(want.p42.rawPercent, 3);
    expect(param.score).toBeCloseTo(want.p42.score, 2);
    expect(result.comparable).toBe(false);
  });

  it('scores only dimension 4 and leaves the other dimensions not measured', async () => {
    const result = await runScan(scanOpts(materializeFixture(name)));
    const scored = result.dimensions.filter((d) => d.score !== null);
    expect(scored.map((d) => d.id)).toEqual([4]);
    // D4 is the weight-redistributed mean of the parameters that were measured.
    const weights = new Map(methodology.dimensions.flatMap((d) => d.parameters).map((def) => [def.id, def.weight]));
    const measured = result.parameters.filter((p) => p.status === 'measured' && p.id.startsWith('4.'));
    const total = measured.reduce((sum, p) => sum + (weights.get(p.id) ?? 0), 0);
    const mean = measured.reduce((sum, p) => sum + (p.score ?? 0) * (weights.get(p.id) ?? 0), 0) / total;
    expect(scored[0]?.score).toBeCloseTo(mean, 6);
    expect(measured.map((p) => p.id)).toContain('4.2');
    expect(result.parameters.every((p) => p.status === 'measured' || p.status === 'not_measured')).toBe(true);
    // 1.1-1.3 and 2.1 are execution layer, so they are not measured in preview.
    expect(result.parameters.find((p) => p.id === '1.2')?.reason).toMatch(/execution/);
  });

  it('stores raw values from which every score can be recomputed', async () => {
    const result = await runScan(scanOpts(materializeFixture(name)));
    const again = recompute(result, methodology);
    expect(again.parameters).toEqual(result.parameters);
    expect(again.dimensions).toEqual(result.dimensions);
    expect(again.health).toEqual(result.health);
  });
});

describe('monorepo breakdown', () => {
  it('pools across packages and languages and reports per package and per group', async () => {
    const want = expected('monorepo');
    const result = await runScan(scanOpts(materializeFixture('monorepo')));
    const units = p42(result).units ?? [];
    expect(
      units.map((u) => ({
        package: u.package,
        group: u.group,
        numerator: u.raw.kind === 'ratio' ? u.raw.numerator : -1,
        denominator: u.raw.kind === 'ratio' ? u.raw.denominator : -1,
      })),
    ).toEqual(want.units);
    expect(Object.keys(result.breakdown.byPackage).sort()).toEqual(['.', 'packages/api', 'packages/lib', 'packages/web']);
    expect(Object.keys(result.breakdown.byGroup).sort()).toEqual(['python', 'typescript_javascript']);
    // packages/web has one 520-line file, so 4.2 is 100% there and the package scores below packages/lib.
    expect(result.breakdown.byPackage['packages/web']?.['4']).toBeLessThan(result.breakdown.byPackage['packages/lib']?.['4'] ?? 0);
  });
});

describe('scope rules', () => {
  it('ignores files git does not track', async () => {
    const dir = materializeFixture('typescript', { 'node_modules/x.js': 'function x() {\n}\n', 'src/untracked.ts': 'export function u() {\n}\n' });
    const scope = await buildScope(dir, methodology);
    expect(scope.files.some((f) => f.path.includes('node_modules') || f.path.includes('untracked'))).toBe(false);
  });

  it('applies .healthignore and reports the excluded share', async () => {
    const dir = materializeFixture('typescript', {}, { '.healthignore': 'src/big.ts\n' });
    const scope = await buildScope(dir, methodology);
    expect(scope.logicLines).toBe(2033 - 520);
    expect(scope.files.some((f) => f.path === 'src/big.ts')).toBe(false);
    expect(scope.excludedLinesPercent).toBeGreaterThan(0);
    expect(scope.excludedLinesPercent).toBeLessThan(100);
    expect(scope.healthignoreSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('counts an unparsable Python file by non-blank lines not starting with # and warns', async () => {
    const dir = materializeFixture('python', {}, { 'app/broken.py': 'def (:\n# comment\nx = 1\n\n' });
    const scope = await buildScope(dir, methodology);
    expect(scope.files.find((f) => f.path === 'app/broken.py')?.logicLines).toBe(2);
    expect(scope.warnings.join('\n')).toMatch(/broken\.py/);
  });

  it('scores 100 for 4.2 when every logic file is small', async () => {
    const dir = materializeFixture('typescript', {}, { '.healthignore': 'src/big.ts\n' });
    const result = await runScan(scanOpts(dir));
    expect(p42(result).score).toBe(100);
  });
});

describe('health scan CLI', () => {
  const io = (cwd: string) => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t), cwd } };
  };

  it('writes run.json and prints health, band and the 4.2 result', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-cwd-'));
    const repo = materializeFixture('typescript');
    const { out, io: cliIo } = io(cwd);
    const code = await run(['scan', repo, '--preview', '--as-of', '2026-10-04'], cliIo);
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toMatch(/^Health 65 Stable \(preview, not comparable\)$/m);
    expect(text).toMatch(/^4\.2 Lines in large files: 25\.6% -> 49$/m);
    expect(text).toMatch(/^4\.1 Complex functions: 0\.0% -> 100$/m);
    const file = JSON.parse(readFileSync(path.join(cwd, 'run.json'), 'utf8')) as RunFile;
    expect(file.mode).toBe('preview');
    expect(file.comparable).toBe(false);
    expect(file.asOf).toBe('2026-10-04');
    expect(file.methodology.version).toBe('1.0');
    expect(file.valid).toBe(true);
  });

  it('honours --out', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-cwd-'));
    const target = path.join(cwd, 'custom.json');
    const { io: cliIo } = io(cwd);
    expect(await run(['scan', materializeFixture('python'), '--preview', '--out', target], cliIo)).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(path.join(cwd, 'run.json'))).toBe(false);
  });

  it('fails on an unknown methodology version with exit 2 and no run.json', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-cwd-'));
    const { err, io: cliIo } = io(cwd);
    const code = await run(['scan', materializeFixture('python'), '--preview', '--methodology', '9.9'], cliIo);
    expect(code).toBe(2);
    expect(err.join('')).toMatch(/Unknown methodology version/);
    expect(existsSync(path.join(cwd, 'run.json'))).toBe(false);
  });

  it('exits 3 and writes nothing for a repository with no logic file', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-cwd-'));
    const empty = materializeFixture('typescript', {}, { '.healthignore': 'src/**\ntest/**\n' });
    const { io: cliIo } = io(cwd);
    expect(await run(['scan', empty, '--preview'], cliIo)).toBe(3);
    expect(existsSync(path.join(cwd, 'run.json'))).toBe(false);
  });

  it('exits 1 without --preview', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-cwd-'));
    const { err, io: cliIo } = io(cwd);
    expect(await run(['scan', materializeFixture('python')], cliIo)).toBe(1);
    expect(err.join('')).toMatch(/health:1\.0/);
  });

  it('exits 1 for a bad --as-of or an unknown command', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-cwd-'));
    const { io: cliIo } = io(cwd);
    expect(await run(['scan', materializeFixture('python'), '--preview', '--as-of', 'yesterday'], cliIo)).toBe(1);
    expect(await run(['nope'], cliIo)).toBe(1);
  });
});
