import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT, run } from '../src/cli.js';
import type { DiffRefused, DiffResult } from '../src/diff/compare.js';
import type { RunFile } from '../src/run/schema.js';
import { runScan } from '../src/run/scan.js';
import { materializeFixture } from './helpers/fixture.js';
import { makeRun } from './helpers/run.js';
import { fakeToolKit } from './helpers/tools.js';

interface Out {
  code: number;
  stdout: string;
  stderr: string;
}

const dir = mkdtempSync(path.join(tmpdir(), 'health-diff-'));
let counter = 0;

function save(runFile: RunFile): string {
  counter += 1;
  const file = path.join(dir, `run-${counter}.json`);
  writeFileSync(file, JSON.stringify(runFile));
  return file;
}

async function diff(a: RunFile, b: RunFile, ...flags: string[]): Promise<Out> {
  return diffFiles(save(a), save(b), ...flags);
}

async function diffFiles(a: string, b?: string, ...flags: string[]): Promise<Out> {
  let stdout = '';
  let stderr = '';
  const code = await run(['diff', a, ...(b === undefined ? [] : [b]), ...flags], { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd: dir });
  return { code, stdout, stderr };
}

async function compared(a: RunFile, b: RunFile): Promise<DiffResult> {
  const out = await diff(a, b, '--json');
  expect(out.code).toBe(EXIT.ok);
  return JSON.parse(out.stdout) as DiffResult;
}

async function refused(a: RunFile, b: RunFile): Promise<DiffRefused> {
  const out = await diff(a, b, '--json');
  expect(out.code).toBe(EXIT.diffRefused);
  return JSON.parse(out.stdout) as DiffRefused;
}

const flat = (scores: number) => makeRun({ scores: Array<number>(6).fill(scores) });
const dimScores = (first: number, rest = 70) => [first, ...Array<number>(5).fill(rest)];

describe('diff: identical runs', () => {
  it('has all deltas 0 and no flag', async () => {
    const result = await compared(flat(70), flat(70));
    expect(result.healthDelta).toBe(0);
    expect(result.dimensions.every((d) => d.delta === 0 && !d.regressed)).toBe(true);
    expect(result.regression).toEqual({ flag: false, dimensions: [], bandDrop: false });
    expect(result.bandChange.dropped).toBe(false);
  });

  it('prints the health line, no dimension lines and no regression', async () => {
    const out = await diff(flat(70), flat(70));
    expect(out.code).toBe(EXIT.ok);
    expect(out.stdout).toBe('Health 70 Stable (+0.0)\nRegression: none\n');
  });
});

describe('diff: regression flag', () => {
  it('flags exactly -3.0 on one dimension', async () => {
    const result = await compared(makeRun({ scores: dimScores(70) }), makeRun({ scores: dimScores(67) }));
    expect(result.regression.flag).toBe(true);
    expect(result.regression.dimensions).toEqual([1]);
    expect(result.dimensions[0]).toMatchObject({ before: 70, after: 67, delta: -3, regressed: true });
  });

  it('does not flag -2.9', async () => {
    const result = await compared(makeRun({ scores: dimScores(70) }), makeRun({ scores: dimScores(67.1) }));
    expect(result.regression.flag).toBe(false);
    expect(result.dimensions[0]?.delta).toBe(-3);
  });

  it('does not flag a displayed -3 that is really -2.96', async () => {
    const result = await compared(makeRun({ scores: dimScores(70) }), makeRun({ scores: dimScores(67.04) }));
    expect(result.dimensions[0]).toMatchObject({ before: 70, after: 67, delta: -3, regressed: false });
    expect(result.regression.flag).toBe(false);
  });

  it('flags a band drop when every dimension drops by less than 3.0', async () => {
    const result = await compared(flat(60), flat(59.4));
    expect(result.before.health.displayed).toBe(60);
    expect(result.after.health.displayed).toBe(59);
    expect(result.bandChange).toEqual({ from: 'stable', to: 'fragile', fromName: 'Stable', toName: 'Fragile', dropped: true });
    expect(result.regression).toEqual({ flag: true, dimensions: [], bandDrop: true });
  });

  it('does not flag a band rise', async () => {
    const result = await compared(flat(59), flat(65));
    expect(result.bandChange.dropped).toBe(false);
    expect(result.regression.flag).toBe(false);
  });

  it('lists a null dimension with null deltas and never flags it', async () => {
    const result = await compared(makeRun({ scores: [null, 70, 70, 70, 70, 70] }), makeRun({ scores: dimScores(10) }));
    expect(result.dimensions[0]).toMatchObject({ before: null, after: 10, delta: null, regressed: false });
  });

  it('names the regression in the human output', async () => {
    const out = await diff(makeRun({ scores: dimScores(70) }), makeRun({ scores: dimScores(60) }));
    expect(out.stdout).toContain('Dimension 1 Safety net: -10');
    expect(out.stdout).toMatch(/Regression: .*-10/);
  });
});

describe('diff: rounding', () => {
  it('rounds the health delta half up to one decimal', async () => {
    expect((await compared(flat(70), flat(70.25))).healthDelta).toBe(0.3);
    expect((await compared(flat(70), flat(70.24))).healthDelta).toBe(0.2);
    expect((await compared(flat(70.25), flat(70))).healthDelta).toBe(-0.2);
  });

  it('rounds a dimension delta from the unrounded scores, not from displayed ones', async () => {
    // Displayed 70 -> 70 (70.4 -> 69.6 displays as 70), but the unrounded delta is -0.8, which rounds to -1.
    const result = await compared(makeRun({ scores: dimScores(70.4) }), makeRun({ scores: dimScores(69.6) }));
    expect(result.dimensions[0]).toMatchObject({ before: 70, after: 70, delta: -1 });
  });

  it('never returns negative zero', async () => {
    const result = await compared(flat(70), flat(70 - 1e-11));
    expect(Object.is(result.healthDelta, -0)).toBe(false);
    expect(result.healthDelta).toBe(0);
    expect(result.dimensions.every((d) => !Object.is(d.delta, -0))).toBe(true);
  });
});

describe('diff: refusals', () => {
  it('refuses different layers', async () => {
    const out = await refused(makeRun(), makeRun({ layers: ['static'] }));
    expect(out.refusals).toEqual([{ condition: 'layers', message: 'layers differ (a: static+execution, b: static)' }]);
  });

  it('refuses different tool versions and names the differing key with both values', async () => {
    const out = await refused(makeRun(), makeRun({ tools: { image: { digest: 'sha256:def' } } }));
    expect(out.refusals).toEqual([
      { condition: 'tool_versions', message: 'tool versions differ: tools.image.digest a=sha256:abc b=sha256:def' },
    ]);
  });

  it('refuses a host tool version that is not the image digest', async () => {
    const out = await refused(makeRun(), makeRun({ tools: { typescript: '5.10.0' } }));
    expect(out.refusals[0]?.message).toBe('tool versions differ: tools.typescript a=5.9.3 b=5.10.0');
  });

  it('refuses a different methodology version without loading it', async () => {
    const out = await refused(makeRun(), makeRun({ methodology: { version: '1.1' } }));
    expect(out.refusals).toEqual([
      {
        condition: 'methodology_version',
        message: 'methodology version differs (a: 1.0, b: 1.1); runs from different versions are never compared',
      },
    ]);
  });

  it('refuses a different as-of date', async () => {
    const out = await refused(makeRun({ asOf: '2026-10-02' }), makeRun({ asOf: '2026-10-03' }));
    expect(out.refusals).toEqual([{ condition: 'as_of_date', message: 'as-of date differs (a: 2026-10-02, b: 2026-10-03)' }]);
  });

  it('refuses a different ignore set and names which file changed', async () => {
    const ignoreSet = { healthignoreSha256: 'x', gitleaksignoreSha256: null, excludedLinesPercent: 0 };
    const out = await refused(makeRun(), makeRun({ ignoreSet }));
    expect(out.refusals).toEqual([{ condition: 'ignore_set', message: 'ignore set differs: .healthignore hash' }]);
    const both = { healthignoreSha256: 'x', gitleaksignoreSha256: 'y', excludedLinesPercent: 0 };
    expect((await refused(makeRun(), makeRun({ ignoreSet: both }))).refusals[0]?.message).toBe(
      'ignore set differs: .healthignore hash, .gitleaksignore hash',
    );
  });

  it('does not compare excludedLinesPercent', async () => {
    const ignoreSet = { healthignoreSha256: null, gitleaksignoreSha256: null, excludedLinesPercent: 12 };
    expect((await compared(makeRun(), makeRun({ ignoreSet }))).regression.flag).toBe(false);
  });

  it('reports every mismatch together, in the YAML order', async () => {
    const out = await refused(makeRun(), makeRun({ layers: ['static'], asOf: '2026-10-05', tools: { node: 'v24.0.0' } }));
    expect(out.refusals.map((r) => r.condition)).toEqual(['layers', 'tool_versions', 'as_of_date']);
  });

  it('refuses a preview run as not comparable and names the side and reason', async () => {
    const preview = makeRun({ mode: 'preview', comparable: false, comparableReason: 'preview, not comparable' });
    const before = await refused(preview, makeRun());
    expect(before.refusals).toEqual([
      { condition: 'run_not_comparable', message: 'before run is not comparable: preview, not comparable' },
    ]);
    const after = await refused(makeRun(), preview);
    expect(after.refusals[0]?.message).toBe('after run is not comparable: preview, not comparable');
  });

  it('refuses an invalid run with its reason, and a run with no health', async () => {
    const invalid = makeRun({ valid: false, invalidReason: 'tool crashed', health: null, dimensions: [] });
    expect((await refused(makeRun(), invalid)).refusals[0]?.message).toBe('after run is not comparable: tool crashed');
    const noHealth = makeRun({ scores: [null, null, null, null, null, null] });
    expect((await refused(noHealth, makeRun())).refusals[0]?.message).toBe('before run is not comparable: run has no health score');
  });

  it('refuses two preview scans of the same fixture as not comparable', async () => {
    const repo = materializeFixture('typescript');
    const opts = { repoPath: repo, methodologyVersion: '1.0', mode: 'preview' as const, asOf: '2026-10-04' };
    const first = await runScan({ ...opts, tools: fakeToolKit() });
    const second = await runScan({ ...opts, tools: fakeToolKit() });
    const out = await diff(first, second, '--json');
    expect(out.code).toBe(EXIT.diffRefused);
    expect((JSON.parse(out.stdout) as DiffRefused).refusals.map((r) => r.condition)).toEqual(['run_not_comparable', 'run_not_comparable']);
  });
});

describe('diff: --json and exit codes', () => {
  it('has exactly the documented keys when compared', async () => {
    const result = await compared(flat(70), flat(75));
    expect(Object.keys(result)).toEqual([
      'schemaVersion',
      'compared',
      'methodologyVersion',
      'asOf',
      'before',
      'after',
      'healthDelta',
      'bandChange',
      'dimensions',
      'regression',
    ]);
    expect(Object.keys(result.before)).toEqual(['path', 'headCommit', 'treeHash', 'health']);
    expect(Object.keys(result.before.health)).toEqual(['score', 'displayed', 'band', 'bandName']);
    expect(Object.keys(result.bandChange)).toEqual(['from', 'to', 'fromName', 'toName', 'dropped']);
    expect(result.dimensions).toHaveLength(6);
    expect(Object.keys(result.dimensions[0] ?? {})).toEqual(['id', 'key', 'name', 'before', 'after', 'delta', 'regressed']);
    expect(result.dimensions.map((d) => d.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Object.keys(result.regression)).toEqual(['flag', 'dimensions', 'bandDrop']);
    expect(result).toMatchObject({ schemaVersion: 1, compared: true, methodologyVersion: '1.0', asOf: '2026-10-04', healthDelta: 5 });
    expect(result.before.path).toBe('/work/repo');
  });

  it('has exactly the documented keys when refused', async () => {
    const out = await refused(makeRun(), makeRun({ asOf: '2026-10-05' }));
    expect(Object.keys(out)).toEqual(['schemaVersion', 'compared', 'refusals']);
    expect(out).toMatchObject({ schemaVersion: 1, compared: false });
    expect(Object.keys(out.refusals[0] ?? {})).toEqual(['condition', 'message']);
  });

  it('writes one JSON object to stdout and nothing to stderr in --json mode', async () => {
    const ok = await diff(flat(70), flat(60), '--json');
    expect(ok.stderr).toBe('');
    expect(ok.stdout.trim().split('\n')).toHaveLength(1);
    const no = await diff(makeRun(), makeRun({ asOf: '2026-10-05' }), '--json');
    expect(no.stderr).toBe('');
    expect(no.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('exits 0 with a regression flag set', async () => {
    const out = await diff(flat(70), flat(50), '--json');
    expect(out.code).toBe(EXIT.ok);
    expect((JSON.parse(out.stdout) as DiffResult).regression.flag).toBe(true);
  });

  it('prints refusals to stderr and exits 5 without --json', async () => {
    const out = await diff(makeRun(), makeRun({ asOf: '2026-10-05' }));
    expect(out.code).toBe(5);
    expect(out.stdout).toBe('');
    expect(out.stderr).toBe('Refused: as-of date differs (a: 2026-10-04, b: 2026-10-05)\n');
  });

  it('exits 1 for usage and bad input', async () => {
    const good = save(makeRun());
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    const wrong = path.join(dir, 'wrong.json');
    writeFileSync(wrong, JSON.stringify({ ...makeRun(), schemaVersion: 2 }));
    expect((await diffFiles(good)).code).toBe(EXIT.usage);
    expect((await diffFiles(good, path.join(dir, 'missing.json'))).code).toBe(EXIT.usage);
    const notJson = await diffFiles(good, bad);
    expect(notJson.code).toBe(EXIT.usage);
    expect(notJson.stderr).toContain('not valid JSON');
    const version = await diffFiles(good, wrong);
    expect(version.code).toBe(EXIT.usage);
    expect(version.stderr).toContain('schemaVersion');
    expect((await diffFiles(good, good, '--nope')).code).toBe(EXIT.usage);
  });

  it('lists exit code 5 in --help text', async () => {
    let stderr = '';
    await run([], { stdout: () => undefined, stderr: (t) => (stderr += t), cwd: dir });
    expect(stderr).toContain('5 diff refused');
  });
});
