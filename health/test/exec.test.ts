import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { createDockerRunner, dockerArgs, type Spawn } from '../src/exec/docker.js';
import { planExecution } from '../src/exec/plan.js';
import { parseEslint, parseMypy, parsePyright, parseRuff, parseTsc } from '../src/exec/reports.js';
import type { StepSpec } from '../src/exec/types.js';
import { p21 } from '../src/measure/p2-1.js';
import { p25 } from '../src/measure/p2-5.js';
import { p61 } from '../src/measure/p6-1.js';
import { loadMethodology } from '../src/methodology/load.js';
import { runScan } from '../src/run/scan.js';
import type { RunFile } from '../src/run/schema.js';
import { buildScope } from '../src/scope/build.js';
import { ToolError } from '../src/scope/types.js';
import { trackedPaths } from '../src/scope/tracked.js';
import { fixturesDir, materializeFixture } from './helpers/fixture.js';
import { FAKE_DIGEST, fakeRunner, type FakeStep } from './helpers/exec.js';
import { fakeToolKit } from './helpers/tools.js';

const methodology = loadMethodology('1.0');
// Full mode needs the static tools of the whole registry; these tests are about the execution layer only.
const executionMeasurers = [p21, p25, p61];
const { runner: runnerConfig, timeouts_seconds: timeouts } = methodology.execution;

const fullOpts = (repoPath: string, execRunner: ReturnType<typeof fakeRunner>) => ({
  repoPath,
  methodologyVersion: '1.0',
  mode: 'full' as const,
  asOf: '2026-10-04',
  tools: fakeToolKit(),
  execRunner,
  imageDigest: FAKE_DIGEST,
  measurers: executionMeasurers,
});

interface Expected {
  p61?: { level: string; score: number };
  p21?: { numerator: number; denominator: number; perThousand: number };
  p25?: { numerator: number; denominator: number; perThousand: number };
}
const expected = (name: string) => JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Expected;
const param = (result: RunFile, id: string) => {
  const found = result.parameters.find((p) => p.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

const TSC_ERROR = "src/index.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.\n";
const ESLINT_FINDING = JSON.stringify([
  { filePath: '/work/src/index.js', messages: [{ ruleId: 'no-self-compare', severity: 2, message: 'Comparing to itself is potentially pointless.' }] },
]);

/** A runner that behaves like a repository where install, build, typecheck and lint all work and report nothing. */
function healthy(overrides: (spec: StepSpec) => FakeStep | undefined = () => undefined) {
  return fakeRunner((spec) => {
    const custom = overrides(spec);
    if (custom) return custom;
    if (spec.step === 'typecheck') return { exitCode: 0, files: { 'tsc.txt': '', 'pyright.json': '{"generalDiagnostics":[]}', 'mypy.txt': '' } };
    if (spec.step === 'lint') return { exitCode: 0, files: { 'eslint.json': '[]', 'ruff.json': '[]' } };
    return { exitCode: 0 };
  });
}

describe('docker runner', () => {
  const spec = (over: Partial<StepSpec> = {}): StepSpec => ({
    label: 'build-1',
    step: 'build',
    network: false,
    argv: ['npm', 'run', 'build'],
    cwd: '.',
    timeoutSeconds: 900,
    env: {},
    workDir: '/tmp/w',
    outDir: '/tmp/o',
    ...over,
  });

  it('runs every step with the methodology cpus and memory and turns the network off except for install', () => {
    const build = dockerArgs(spec(), 'n', runnerConfig).join(' ');
    expect(build).toContain(`--cpus ${runnerConfig.cpus} --memory ${runnerConfig.memory_gb}g`);
    expect(runnerConfig).toMatchObject({ cpus: 4, memory_gb: 8 });
    for (const step of ['build', 'typecheck', 'lint'] as const) {
      expect(dockerArgs(spec({ step }), 'n', runnerConfig).join(' ')).toContain('--network none');
    }
    expect(dockerArgs(spec({ step: 'install', network: true }), 'n', runnerConfig)).not.toContain('--network');
    expect(build).toContain(`-v /tmp/w:/work -v /tmp/o:/out -w /work ${runnerConfig.image} npm run build`);
  });

  it('runs as the host user with a writable HOME, and as the image user where the host has no uid', () => {
    const args = dockerArgs(spec(), 'n', runnerConfig, { uid: 1000, gid: 124 }).join(' ');
    expect(args).toContain('--user 1000:124 -e HOME=/tmp');
    const windows = dockerArgs(spec(), 'n', runnerConfig, null);
    expect(windows).not.toContain('--user');
    expect(windows.join(' ')).not.toContain('HOME=');
  });

  it('passes env example pairs as -e and sets the working directory inside /work', () => {
    const args = dockerArgs(spec({ env: { A: '1', B: 'two' }, cwd: 'packages/api' }), 'n', runnerConfig);
    expect(args.join(' ')).toContain('-e A=1 -e B=two');
    expect(args.join(' ')).toContain('-w /work/packages/api');
  });

  function fakeSpawn(exitCode: number | null, opts: { hang?: boolean; error?: string } = {}) {
    const calls: string[][] = [];
    let running: EventEmitter | null = null;
    const spawn = ((_cmd: string, args: string[]) => {
      calls.push(args);
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      if (args[0] === 'kill') {
        // `docker kill` ends the hanging container, which exits 137.
        queueMicrotask(() => {
          child.emit('close', 0);
          running?.emit('close', 137);
        });
      } else if (opts.hang) running = child;
      else queueMicrotask(() => (opts.error ? child.emit('error', new Error(opts.error)) : child.emit('close', exitCode)));
      return child;
    }) as unknown as Spawn;
    return { spawn, calls };
  }

  it('records ok and failed from the exit code', async () => {
    expect((await createDockerRunner(runnerConfig, fakeSpawn(0).spawn).runStep(spec())).status).toBe('ok');
    const failed = await createDockerRunner(runnerConfig, fakeSpawn(1).spawn).runStep(spec());
    expect(failed).toMatchObject({ status: 'failed', exitCode: 1, outputDir: '/tmp/o' });
    expect(failed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it.each([125, 126, 127])('treats exit %i as a tool error', async (code) => {
    await expect(createDockerRunner(runnerConfig, fakeSpawn(code).spawn).runStep(spec())).rejects.toBeInstanceOf(ToolError);
  });

  it('treats a missing docker binary as a tool error', async () => {
    await expect(createDockerRunner(runnerConfig, fakeSpawn(null, { error: 'spawn docker ENOENT' }).spawn).runStep(spec())).rejects.toThrow(/docker could not start/);
  });

  it('kills the container when the step timeout passes and records a timeout', async () => {
    const { spawn, calls } = fakeSpawn(137, { hang: true });
    const outcome = await createDockerRunner(runnerConfig, spawn).runStep(spec({ timeoutSeconds: 0.01 }));
    expect(outcome.status).toBe('timeout');
    expect(calls.some((args) => args[0] === 'kill' && /^health-[0-9a-f]+-build-1$/.test(args[1] ?? ''))).toBe(true);
  });
});

describe('step commands', () => {
  it('uses the timeouts from methodology.yaml', async () => {
    const dir = materializeFixture('exec-type-error');
    const runner = healthy();
    await runScan(fullOpts(dir, runner));
    const byStep = Object.fromEntries(runner.specs.map((s) => [s.step, s]));
    expect(byStep.install?.timeoutSeconds).toBe(timeouts.install);
    expect(byStep.typecheck?.timeoutSeconds).toBe(timeouts.typecheck);
    expect(byStep.lint?.timeoutSeconds).toBe(timeouts.lint);
  });

  it('turns the network on for install only', async () => {
    const dir = materializeFixture('exec-build-fail');
    const runner = healthy();
    await runScan(fullOpts(dir, runner));
    expect(runner.specs.map((s) => [s.step, s.network])).toEqual([
      ['install', true],
      ['build', false],
      ['typecheck', false],
      ['lint', false],
    ]);
  });

  it('loads the env example values', async () => {
    const dir = materializeFixture('exec-lint-finding', {}, { '.env.example': 'API_URL=http://localhost\nDEBUG="1"\n' });
    const runner = healthy();
    await runScan(fullOpts(dir, runner));
    expect(runner.specs.every((s) => s.env.API_URL === 'http://localhost' && s.env.DEBUG === '1')).toBe(true);
  });

  it('picks the install command by lockfile', async () => {
    const cases: [string, string[]][] = [
      ['package-lock.json', ['npm', 'ci']],
      ['pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile']],
      ['yarn.lock', ['yarn', 'install', '--immutable']],
      ['bun.lock', ['bun', 'install', '--frozen-lockfile']],
    ];
    for (const [lock, argv] of cases) {
      const runner = healthy();
      await runScan(fullOpts(materializeFixture('exec-lint-finding', {}, { [lock]: '' }), runner));
      expect(runner.specs[0]?.argv).toEqual(argv);
    }
    const none = healthy();
    await runScan(fullOpts(materializeFixture('exec-lint-finding'), none));
    expect(none.specs[0]?.argv).toEqual(['npm', 'install']);
  });

  it('chooses Python installs and builds', async () => {
    const files = { 'pkg/__init__.py': 'x = 1\n', 'pkg/a.py': 'def f():\n    return 1\n', 'uv.lock': '', 'pyproject.toml': '[project]\nname = "p"\n' };
    const runner = healthy();
    await runScan(fullOpts(materializeFixture('blank', {}, files), runner));
    expect(runner.specs.map((s) => s.argv)).toEqual(
      expect.arrayContaining([
        ['uv', 'sync', '--frozen'],
        ['health-venv', 'python', '-c', 'import pkg'],
        expect.arrayContaining(['health-venv', 'pyright', '--outputjson']),
      ]),
    );
  });
});

describe('install roots', () => {
  it('installs a workspace once at its root and each separate project at its own', async () => {
    const files = {
      'package.json': '{"workspaces":["packages/*"]}\n',
      'packages/a/package.json': '{}\n',
      'packages/a/index.js': 'export function a() {\n  return 1;\n}\n',
      'packages/b/package.json': '{}\n',
      'packages/b/index.js': 'export function b() {\n  return 1;\n}\n',
      'api/pyproject.toml': '[project]\nname = "api"\n',
      'api/main.py': 'def main():\n    return 1\n',
    };
    const dir = materializeFixture('blank', {}, files);
    const scope = await buildScope(dir, methodology);
    const plan = planExecution(scope, trackedPaths(dir));
    expect(plan.roots.map((r) => [r.dir, r.group])).toEqual([
      ['.', 'typescript_javascript'],
      ['api', 'python'],
    ]);
    expect(plan.roots[0]?.weight).toBe(6);
  });
});

describe('report parsers', () => {
  it('reads tsc errors and treats an error without a location as a config error', () => {
    expect(parseTsc(`${TSC_ERROR}  more detail\n`, '.')).toEqual({ files: ['src/index.ts'] });
    expect(parseTsc('packages/a/x.ts(3,1): error TS2304: Cannot find name.\n', 'packages/a')?.files).toEqual(['packages/a/packages/a/x.ts']);
    expect(parseTsc("error TS5083: Cannot read file '/work/tsconfig.json'.\n", '.')).toBeNull();
  });

  it('maps absolute and relative paths and ignores warnings', () => {
    expect(parseTsc('x.ts(1,1): error TS1: a\n', 'sub')?.files).toEqual(['sub/x.ts']);
    expect(parsePyright(JSON.stringify({ generalDiagnostics: [{ file: '/work/a.py', severity: 'error', rule: 'r', range: { start: { line: 1, character: 0 } } }, { file: '/work/a.py', severity: 'warning' }] }), '.')?.files).toEqual(['a.py']);
    expect(parseMypy('a.py:3: error: bad  [misc]\nb.py:4:2: error: bad\nNote: x\n', '.')?.files).toEqual(['a.py', 'b.py']);
    expect(parseEslint('[{"filePath":"/work/a.js","messages":[{"ruleId":null,"fatal":true},{"ruleId":"x"}]}]', '.')?.files).toEqual(['a.js', 'a.js']);
    expect(parseRuff('[{"filename":"/work/a.py","code":"F401"}]', '.')?.files).toEqual(['a.py']);
    expect(parseEslint('not json', '.')).toBeNull();
  });
});

describe('fixtures through a fake runner', () => {
  it('zeroes every execution parameter when the install fails', async () => {
    const dir = materializeFixture('exec-install-fail');
    const runner = healthy((spec) => (spec.step === 'install' ? { exitCode: 1 } : undefined));
    const result = await runScan(fullOpts(dir, runner));
    expect(runner.specs.map((s) => s.step)).toEqual(['install']);
    for (const id of ['6.1', '2.1', '2.5']) expect(param(result, id).score).toBe(0);
    expect(param(result, '6.1').units?.[0]?.raw).toEqual({ kind: 'level', level: expected('exec-install-fail').p61?.level });
    expect(param(result, '2.1').status).toBe('failed');
  });

  it('scores 6.1 as 40 when only the build fails', async () => {
    const dir = materializeFixture('exec-build-fail');
    const runner = healthy((spec) => (spec.step === 'build' ? { exitCode: 1 } : undefined));
    const result = await runScan(fullOpts(dir, runner));
    expect(param(result, '6.1').score).toBe(expected('exec-build-fail').p61?.score);
    expect(param(result, '6.1').units?.[0]?.raw).toEqual({ kind: 'level', level: 'build_fails' });
  });

  it('scores 6.1 as 100 when there is no build step', async () => {
    const result = await runScan(fullOpts(materializeFixture('exec-lint-finding'), healthy()));
    expect(param(result, '6.1').score).toBe(100);
  });

  it('scores a planted type error per 1,000 source lines', async () => {
    const want = expected('exec-type-error').p21 ?? { numerator: 0, denominator: 1, perThousand: 0 };
    const runner = healthy((spec) => (spec.step === 'typecheck' ? { exitCode: 2, files: { 'tsc.txt': TSC_ERROR } } : undefined));
    const result = await runScan(fullOpts(materializeFixture('exec-type-error'), runner));
    const p21 = param(result, '2.1');
    expect(p21.raw).toEqual({ kind: 'ratio', numerator: want.numerator, denominator: want.denominator, scale: 1000 });
    expect((want.numerator / want.denominator) * 1000).toBe(want.perThousand);
    expect(p21.score).toBeCloseTo(0, 6);
  });

  it('scores a planted lint finding per 1,000 source lines', async () => {
    const want = expected('exec-lint-finding').p25 ?? { numerator: 0, denominator: 1, perThousand: 0 };
    const runner = healthy((spec) => (spec.step === 'lint' ? { exitCode: 1, files: { 'eslint.json': ESLINT_FINDING } } : undefined));
    const result = await runScan(fullOpts(materializeFixture('exec-lint-finding'), runner));
    const p25 = param(result, '2.5');
    expect(p25.raw).toEqual({ kind: 'ratio', numerator: want.numerator, denominator: want.denominator, scale: 1000 });
    expect(((want.numerator / want.denominator) * 1000).toFixed(3)).toBe(want.perThousand.toFixed(3));
  });

  it('counts the merged health-eslint report for TS files outside every tsconfig', async () => {
    const want = expected('exec-lint-outside-tsconfig').p25 ?? { numerator: 0, denominator: 1 };
    const out = JSON.stringify([
      { filePath: '/work/src/index.ts', messages: [{ ruleId: '@typescript-eslint/no-floating-promises', severity: 2, message: 'Promises must be awaited.' }] },
      { filePath: '/work/scripts/outside.ts', messages: [] },
      { filePath: '/work/scripts/unused.ts', messages: [{ ruleId: '@typescript-eslint/no-unused-vars', severity: 2, message: "'spare' is assigned a value but never used." }] },
      { filePath: '/work/scripts/broken.ts', messages: [{ ruleId: null, fatal: true, severity: 2, message: 'Parsing error: Expression expected.' }] },
    ]);
    const runner = healthy((spec) => (spec.step === 'lint' ? { exitCode: 1, files: { 'eslint.json': out } } : undefined));
    const result = await runScan(fullOpts(materializeFixture('exec-lint-outside-tsconfig'), runner));
    expect(param(result, '2.5').raw).toEqual({ kind: 'ratio', numerator: want.numerator, denominator: want.denominator, scale: 1000 });
  });

  it('runs the lint step through health-eslint', async () => {
    const specs: StepSpec[] = [];
    await runScan(fullOpts(materializeFixture('exec-lint-outside-tsconfig'), healthy((spec) => { specs.push(spec); return undefined; })));
    expect(specs.find((spec) => spec.step === 'lint')?.argv.slice(0, 3)).toEqual(['health-capture', '/out/eslint.json', 'health-eslint']);
  });

  it('drops findings outside in-scope files', async () => {
    const out = JSON.stringify([{ filePath: '/work/node_modules/x/index.js', messages: [{ ruleId: 'x' }] }]);
    const runner = healthy((spec) => (spec.step === 'lint' ? { exitCode: 1, files: { 'eslint.json': out } } : undefined));
    const result = await runScan(fullOpts(materializeFixture('exec-lint-finding'), runner));
    expect(param(result, '2.5').raw).toMatchObject({ numerator: 0, denominator: 6 });
  });

  it('scores 0 for a typecheck or lint that times out or has no report', async () => {
    const timedOut = healthy((spec) => (spec.step === 'typecheck' ? { exitCode: 0, timeout: true } : undefined));
    const a = await runScan(fullOpts(materializeFixture('exec-type-error'), timedOut));
    expect(param(a, '2.1')).toMatchObject({ status: 'failed', score: 0 });
    const noReport = healthy((spec) => (spec.step === 'lint' ? { exitCode: 2 } : undefined));
    const b = await runScan(fullOpts(materializeFixture('exec-lint-finding'), noReport));
    expect(param(b, '2.5')).toMatchObject({ status: 'failed', score: 0 });
    expect(param(b, '2.1')).toBeDefined();
  });

  it('records the image digest and stays not comparable until 1.1-1.3 and 6.3 are measured', async () => {
    const result = await runScan(fullOpts(materializeFixture('exec-lint-finding'), healthy()));
    expect(result.tools.image).toEqual({ tag: 'health:1.0', digest: FAKE_DIGEST });
    expect(result.mode).toBe('full');
    expect(result.layers).toEqual(['static', 'execution']);
    expect(result.comparable).toBe(false);
    expect(result.comparableReason).toMatch(/not measured: 1\.1, 1\.2, 1\.3.*6\.3/);
  });
});

describe('tool errors', () => {
  it('produces an invalid run with no score and exit code 4', async () => {
    const dir = materializeFixture('exec-lint-finding');
    const crashing = { async runStep(): Promise<never> { throw new ToolError('lint could not run in the image (exit 127)'); } };
    const outDir = mkdtempSync(path.join(tmpdir(), 'health-cli-'));
    const outFile = path.join(outDir, 'run.json');
    const stderr: string[] = [];
    const code = await run(['scan', dir, '--out', outFile], { stdout: () => undefined, stderr: (t) => stderr.push(t), cwd: outDir }, { execRunner: crashing, imageDigest: FAKE_DIGEST, tools: fakeToolKit(), measurers: executionMeasurers });
    expect(code).toBe(4);
    const written = JSON.parse(readFileSync(outFile, 'utf8')) as RunFile;
    expect(written).toMatchObject({ valid: false, parameters: [], health: null, mode: 'full' });
    expect(written.invalidReason).toMatch(/exit 127/);
    expect(stderr.join('')).toMatch(/Tool error/);
  });

  it('writes a full run through the CLI with the image digest', async () => {
    const dir = materializeFixture('exec-lint-finding');
    const outDir = mkdtempSync(path.join(tmpdir(), 'health-cli-'));
    const outFile = path.join(outDir, 'run.json');
    let stdout = '';
    const code = await run(['scan', dir, '--out', outFile, '--as-of', '2026-10-04'], { stdout: (t) => (stdout += t), stderr: () => undefined, cwd: outDir }, { execRunner: healthy(), imageDigest: FAKE_DIGEST, tools: fakeToolKit(), measurers: executionMeasurers });
    expect(code).toBe(0);
    expect(stdout).toMatch(/not comparable/);
    expect((JSON.parse(readFileSync(outFile, 'utf8')) as RunFile).tools.image?.digest).toBe(FAKE_DIGEST);
  });
});
