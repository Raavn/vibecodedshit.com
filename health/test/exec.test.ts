import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { createDockerRunner, dockerArgs, packageCacheDir, type Spawn } from '../src/exec/docker.js';
import { planExecution } from '../src/exec/plan.js';
import { parseEslint, parseMypy, parsePyright, parseRuff, parseTsc } from '../src/exec/reports.js';
import type { StepSpec } from '../src/exec/types.js';
import { p21 } from '../src/measure/p2-1.js';
import { p25 } from '../src/measure/p2-5.js';
import { p44 } from '../src/measure/p4-4.js';
import { p55 } from '../src/measure/p5-5.js';
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
const healthDir = path.resolve(fixturesDir, '..', '..');

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
    if (spec.step === 'knip') return { exitCode: 0, files: { 'knip.json': '{"issues":[]}' } };
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

  it('mounts the package cache and points every package manager at it in network-on steps only', () => {
    const install = dockerArgs(spec({ step: 'install', network: true }), 'n', runnerConfig, null, '/c').join(' ');
    expect(install).toContain('-v /tmp/o:/out -v /c:/cache -w /work');
    for (const pair of [
      'npm_config_cache=/cache/npm',
      'PNPM_HOME=/cache/pnpm',
      'YARN_GLOBAL_FOLDER=/cache/yarn',
      'BUN_INSTALL_CACHE_DIR=/cache/bun',
      'PIP_CACHE_DIR=/cache/pip',
      'UV_CACHE_DIR=/cache/uv',
      'POETRY_CACHE_DIR=/cache/poetry',
      'PDM_CACHE_DIR=/cache/pdm',
      'PIPENV_CACHE_DIR=/cache/pipenv',
    ]) {
      expect(install).toContain(`-e ${pair}`);
    }
    expect(dockerArgs(spec(), 'n', runnerConfig, null, '/c').join(' ')).not.toContain('/cache');
    expect(dockerArgs(spec({ step: 'install', network: true }), 'n', runnerConfig, null, null).join(' ')).not.toContain('/cache');
  });

  it('takes the cache directory from HEALTH_PACKAGE_CACHE, then XDG_CACHE_HOME, then the home directory', () => {
    expect(packageCacheDir({ HEALTH_PACKAGE_CACHE: '/x/y' }, '/h')).toBe('/x/y');
    expect(packageCacheDir({ HEALTH_PACKAGE_CACHE: 'off', XDG_CACHE_HOME: '/xdg' }, '/h')).toBeNull();
    expect(packageCacheDir({ XDG_CACHE_HOME: '/xdg' }, '/h')).toBe('/xdg/health/packages');
    expect(packageCacheDir({}, '/h')).toBe('/h/.cache/health/packages');
  });

  it('creates the cache directory before a network-on step, not before the others', async () => {
    const cache = path.join(mkdtempSync(path.join(tmpdir(), 'health-cache-')), 'packages');
    await createDockerRunner(runnerConfig, fakeSpawn(0).spawn, cache).runStep(spec());
    expect(existsSync(cache)).toBe(false);
    const { spawn, calls } = fakeSpawn(0);
    await createDockerRunner(runnerConfig, spawn, cache).runStep(spec({ step: 'install', network: true }));
    expect(existsSync(cache)).toBe(true);
    expect(calls[0]?.join(' ')).toContain(`-v ${cache}:/cache`);
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
    expect(byStep.knip?.timeoutSeconds).toBe(timeouts.lint);
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
      ['knip', false],
    ]);
  });

  it('runs knip in the image with the baked-in empty config, its JSON report captured to /out', async () => {
    const runner = healthy();
    await runScan(fullOpts(materializeFixture('exec-lint-finding'), runner));
    expect(runner.specs.filter((s) => s.step === 'knip').map((s) => [s.cwd, s.argv])).toEqual([
      [
        '.',
        ['health-capture', '/out/knip.json', 'env', 'DOTENV_CONFIG_QUIET=true', 'knip', '--reporter', 'json', '--no-progress', '--no-config-hints', '--config', '/opt/health/knip.json'],
      ],
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

  it('installs from the same lockfile 5.3 scores when there are several', async () => {
    const want = JSON.parse(readFileSync(path.join(fixturesDir, 'd5-lock-multi', 'expected.json'), 'utf8')) as { install: string[] };
    const runner = healthy();
    await runScan(fullOpts(materializeFixture('d5-lock-multi'), runner));
    expect(runner.specs[0]?.argv).toEqual(want.install);
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

// ---- knip on the installed work copy (4.4, 5.5) ----------------------------------------------

describe('knip on the installed work copy', () => {
  const want = JSON.parse(readFileSync(path.join(fixturesDir, 'exec-knip-vitest', 'expected.json'), 'utf8')) as {
    full: { p55: { numerator: number; denominator: number }; p44: { numerator: number; denominator: number } };
    previewReason: string;
    failedInstallReason: string;
  };
  const knipMeasurers = [p44, p55, p61];

  /** What `npm install` would leave behind: vitest (with vitest/config) and prisma (with its binary). */
  function installPackages(workDir: string): void {
    const write = (rel: string, text: string): void => {
      mkdirSync(path.dirname(path.join(workDir, rel)), { recursive: true });
      writeFileSync(path.join(workDir, rel), text);
    };
    write('node_modules/vitest/package.json', JSON.stringify({ name: 'vitest', version: '3.2.4', type: 'module', exports: { '.': './index.js', './config': './config.js' }, bin: { vitest: 'vitest.mjs' } }));
    write('node_modules/vitest/config.js', 'export function defineConfig(config) { return config; }\n');
    write('node_modules/vitest/index.js', 'export {};\n');
    write('node_modules/vitest/vitest.mjs', '\n');
    write('node_modules/prisma/package.json', JSON.stringify({ name: 'prisma', version: '6.0.0', bin: { prisma: 'build/index.js' } }));
    write('node_modules/prisma/build/index.js', '\n');
  }

  /** A real tool kit (knip is real) that records the directory every tool ran in. */
  function recordingKit(): { kit: ReturnType<typeof fakeToolKit>; cwds: { name: string; cwd: string }[] } {
    const kit = fakeToolKit();
    const cwds: { name: string; cwd: string }[] = [];
    const runTool = kit.run.bind(kit);
    kit.run = (tool, args, opts) => {
      cwds.push({ name: tool.name, cwd: opts.cwd });
      return runTool(tool, args, opts);
    };
    return { kit, cwds };
  }

  /** Stands in for the image's knip step: the real knip with the step's argv, in the step's directory of the work copy. */
  function knipStep(spec: StepSpec): FakeStep {
    const argv = spec.argv.slice(spec.argv.indexOf('knip') + 1).map((arg) => (arg === '/opt/health/knip.json' ? path.join(healthDir, 'docker', 'config', 'knip.json') : arg));
    const result = spawnSync(path.join(healthDir, 'node_modules', '.bin', 'knip'), argv, {
      cwd: path.join(spec.workDir, spec.cwd),
      encoding: 'utf8',
      env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' },
    });
    return { exitCode: result.status ?? 2, files: { 'knip.json': result.stdout } };
  }

  const ratioOf = (result: RunFile, id: string): { numerator: number; denominator: number } => {
    const raw = param(result, id).raw;
    if (raw?.kind !== 'ratio') throw new Error(`${id} is not a ratio`);
    return { numerator: raw.numerator, denominator: raw.denominator };
  };

  it('reads the knip step that ran in the installed copy in a full run, then removes the copy', async () => {
    const dir = materializeFixture('exec-knip-vitest');
    const runner = healthy((spec) => {
      if (spec.step === 'knip') return knipStep(spec);
      if (spec.step !== 'install') return undefined;
      installPackages(spec.workDir);
      return { exitCode: 0 };
    });
    const { kit, cwds } = recordingKit();
    const outDir = mkdtempSync(path.join(tmpdir(), 'health-cli-'));
    const outFile = path.join(outDir, 'run.json');
    const code = await run(['scan', dir, '--out', outFile, '--as-of', '2026-10-04'], { stdout: () => undefined, stderr: () => undefined, cwd: outDir }, {
      execRunner: runner,
      imageDigest: FAKE_DIGEST,
      tools: kit,
      measurers: knipMeasurers,
    });
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(outFile, 'utf8')) as RunFile;
    expect(ratioOf(written, '5.5')).toEqual(want.full.p55);
    expect(ratioOf(written, '4.4')).toEqual(want.full.p44);
    expect(runner.specs.filter((s) => s.step === 'knip').map((s) => s.cwd)).toEqual(['.']);
    expect(cwds.filter((c) => c.name === 'knip')).toEqual([]);
    expect(existsSync(runner.specs[0]?.workDir as string)).toBe(false);
  });

  it('is not measured in preview when knip cannot load a config', async () => {
    const result = await runScan({ repoPath: materializeFixture('exec-knip-vitest'), methodologyVersion: '1.0', mode: 'preview', asOf: '2026-10-04', tools: fakeToolKit(), measurers: knipMeasurers });
    for (const id of ['4.4', '5.5']) {
      expect(param(result, id).status).toBe('not_measured');
      expect(param(result, id).reason).toContain(want.previewReason);
    }
  });

  it('names the failed install when knip then fails in a full run', async () => {
    const dir = materializeFixture('exec-knip-vitest');
    const runner = healthy((spec) => (spec.step === 'install' ? { exitCode: 1 } : undefined));
    const { kit, cwds } = recordingKit();
    await expect(runScan({ ...fullOpts(dir, runner), tools: kit, measurers: knipMeasurers })).rejects.toThrow(want.failedInstallReason);
    expect(cwds.find((c) => c.name === 'knip')?.cwd).toBe(path.join(path.resolve(dir), '.'));
    expect(existsSync(runner.specs[0]?.workDir as string)).toBe(false);
  });
});
