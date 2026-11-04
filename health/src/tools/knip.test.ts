import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeToolKit, ok, type FakeTool } from '../../test/helpers/tools.js';
import type { ExecutionResults, KnipResult } from '../exec/types.js';
import type { MeasureContext } from '../measure/types.js';
import { isOutcome, runKnip } from './knip.js';

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'health-knip-unit-'));
  writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  return dir;
}

function step(exitCode: number | null, report: string | null, status: KnipResult['outcome']['status'] = exitCode === 0 ? 'ok' : 'failed'): KnipResult {
  return { dir: '.', outcome: { status, exitCode, durationMs: 1, outputDir: '/out' }, report };
}

function exec(checksRan: boolean, workDir: string, knip: KnipResult[] = []): ExecutionResults {
  const install = { status: checksRan ? ('ok' as const) : ('failed' as const), exitCode: checksRan ? 0 : 1, durationMs: 1, outputDir: '/out' };
  return {
    image: { tag: 'health:1.0', digest: 'sha256:x' },
    roots: [{ dir: '.', group: 'typescript_javascript', weight: 1, install, build: null }],
    checksRan,
    typecheck: [],
    lint: [],
    knip,
    test: { invocations: [] },
    workDir,
  };
}

function context(knip: FakeTool, mode: 'preview' | 'full', execResults?: ExecutionResults): MeasureContext {
  return { repoPath: repo(), mode, tools: fakeToolKit({ knip }), ...(execResults ? { exec: execResults } : {}) } as unknown as MeasureContext;
}

describe('runKnip', () => {
  it('reads the knip steps of the execution layer, not the host knip, when every install worked', async () => {
    const cwds: string[] = [];
    const report = '{"issues":[{"file":"src/a.ts","exports":[{"name":"x"}],"types":[],"files":[],"dependencies":[{"name":"lodash"}]}]}';
    const ctx = context((_args, cwd) => (cwds.push(cwd), ok('{"issues":[]}')), 'full', exec(true, '/work/copy', [step(1, report)]));
    const outcome = await runKnip(ctx);
    expect(cwds).toEqual([]);
    expect(isOutcome(outcome) && outcome.warnings).toEqual([]);
    expect(isOutcome(outcome) && outcome.files.get('src/a.ts')).toMatchObject({ exports: 1, unusedFile: false, dependencies: ['lodash'] });
  });

  it('is not measured when a knip step crashed, timed out or wrote no report', async () => {
    const full = (result: KnipResult) => runKnip(context(() => ok('{"issues":[]}'), 'full', exec(true, '/w', [result])));
    expect(await full(step(2, ''))).toEqual({ status: 'not_measured', reason: 'knip exited with 2 in .' });
    expect(await full(step(null, null, 'timeout'))).toEqual({ status: 'not_measured', reason: 'knip timed out in .' });
    expect(await full(step(0, null))).toEqual({ status: 'not_measured', reason: 'knip wrote no report in .' });
    expect(await full(step(0, 'not json'))).toMatchObject({ status: 'not_measured' });
  });

  it('runs on the execution work copy and warns when an install failed and knip still worked', async () => {
    const cwds: string[] = [];
    const ctx = context((_args, cwd) => (cwds.push(cwd), ok('{"issues":[]}')), 'full', exec(false, '/work/copy'));
    const outcome = await runKnip(ctx);
    expect(cwds).toEqual([path.join('/work/copy', '.')]);
    expect(isOutcome(outcome) && outcome.warnings).toEqual([
      'knip ran without installed dependencies because the dependency install failed in .; unused dependencies may be overcounted',
    ]);
  });

  it('marks the root failed when its install failed and knip then crashes, times out or prints no report', async () => {
    const failed = async (result: { exitCode: number | null; stdout: string; timedOut: boolean }) => {
      const outcome = await runKnip(context(() => ({ ...result, stderr: 'boom' }), 'full', exec(false, '/w')));
      return isOutcome(outcome) ? outcome.failedRoots : outcome;
    };
    expect(await failed({ exitCode: 2, stdout: '', timedOut: false })).toEqual(['.']);
    expect(await failed({ exitCode: null, stdout: '', timedOut: true })).toEqual(['.']);
    expect(await failed({ exitCode: 0, stdout: 'not json', timedOut: false })).toEqual(['.']);
  });

  it('stays not_measured when knip cannot start, even after a failed install', async () => {
    const outcome = await runKnip(context(() => ({ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' }), 'full', exec(false, '/w')));
    expect(outcome).toMatchObject({ status: 'not_measured' });
  });

  it('keeps a knip failure in a root whose install worked not_measured', async () => {
    const outcome = await runKnip(context(() => ok('{"issues":[]}'), 'full', exec(true, '/w', [step(2, '')])));
    expect(outcome).toEqual({ status: 'not_measured', reason: 'knip exited with 2 in .' });
  });

  it('is not measured in preview, with the config error in the reason', async () => {
    const ctx = context(() => ({ exitCode: 2, stdout: '', stderr: 'ERROR: Error loading vitest.config.ts', timedOut: false }), 'preview');
    expect(await runKnip(ctx)).toEqual({ status: 'not_measured', reason: 'knip exited with 2: ERROR: Error loading vitest.config.ts' });
  });
});
