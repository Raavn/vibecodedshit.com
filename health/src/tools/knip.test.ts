import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeToolKit, ok, type FakeTool } from '../../test/helpers/tools.js';
import type { ExecutionResults, KnipResult } from '../exec/types.js';
import type { MeasureContext } from '../measure/types.js';
import { ToolError } from '../scope/types.js';
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

  it('is a tool error when a knip step crashed, timed out or wrote no report', async () => {
    const full = (result: KnipResult) => runKnip(context(() => ok('{"issues":[]}'), 'full', exec(true, '/w', [result])));
    await expect(full(step(2, ''))).rejects.toThrow(/knip exited with 2 in \./);
    await expect(full(step(null, null, 'timeout'))).rejects.toThrow(/knip timed out in \./);
    await expect(full(step(0, null))).rejects.toThrow(/knip wrote no report in \./);
    await expect(full(step(0, 'not json'))).rejects.toThrow(ToolError);
  });

  it('runs in the repository and warns when an install failed and knip still worked', async () => {
    const cwds: string[] = [];
    const ctx = context((_args, cwd) => (cwds.push(cwd), ok('{"issues":[]}')), 'full', exec(false, '/work/copy'));
    const outcome = await runKnip(ctx);
    expect(cwds).toEqual([path.join(ctx.repoPath, '.')]);
    expect(isOutcome(outcome) && outcome.warnings).toEqual([
      'knip ran without installed dependencies because the dependency install failed in .; unused dependencies may be overcounted',
    ]);
  });

  it('names the failed install in the tool error when knip fails', async () => {
    const ctx = context(() => ({ exitCode: 2, stdout: '', stderr: 'ERROR: Error loading vitest.config.ts', timedOut: false }), 'full', exec(false, '/work/copy'));
    await expect(runKnip(ctx)).rejects.toThrow(ToolError);
    await expect(runKnip(context(() => ({ exitCode: 2, stdout: '', stderr: 'boom', timedOut: false }), 'full', exec(false, '/w')))).rejects.toThrow(
      /knip exited with 2: boom \(dependency install failed in \., likely cause\)/,
    );
  });

  it('is not measured in preview, with the config error in the reason', async () => {
    const ctx = context(() => ({ exitCode: 2, stdout: '', stderr: 'ERROR: Error loading vitest.config.ts', timedOut: false }), 'preview');
    expect(await runKnip(ctx)).toEqual({ status: 'not_measured', reason: 'knip exited with 2: ERROR: Error loading vitest.config.ts' });
  });
});
