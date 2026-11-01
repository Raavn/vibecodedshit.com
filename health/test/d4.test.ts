import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { summarize } from '../src/cli.js';
import { loadMethodology } from '../src/methodology/load.js';
import { recompute } from '../src/run/recompute.js';
import type { RunFile, RunParameter } from '../src/run/schema.js';
import { runScan } from '../src/run/scan.js';
import { createToolKit } from '../src/tools/kit.js';
import { FAKE_DIGEST, fakeRunner } from './helpers/exec.js';
import { fixturesDir, materializeFixture } from './helpers/fixture.js';
import { fakeToolKit, ok, type FakeKit, type FakeTool } from './helpers/tools.js';

const methodology = loadMethodology('1.0');

const scan = (repoPath: string, tools: FakeKit, mode: 'preview' | 'full' = 'preview'): Promise<RunFile> =>
  runScan({ repoPath, methodologyVersion: '1.0', mode, asOf: '2026-10-04', tools, ...(mode === 'full' ? { execRunner: fakeRunner((spec) => (spec.step === 'knip' ? { exitCode: 0, files: { 'knip.json': '{"issues":[]}' } } : { exitCode: 0 })), imageDigest: FAKE_DIGEST } : {}) });

const expected = (name: string): Record<string, never> =>
  JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Record<string, never>;

function param(run: RunFile, id: string): RunParameter {
  const found = run.parameters.find((p) => p.id === id);
  if (!found) throw new Error(`no parameter ${id}`);
  return found;
}

function unitRatios(p: RunParameter): Record<string, { numerator: number; denominator: number }> {
  return Object.fromEntries(
    (p.units ?? []).map((u) => {
      if (u.raw.kind !== 'ratio') throw new Error('not a ratio');
      return [u.package.split('/').pop() ?? u.package, { numerator: u.raw.numerator, denominator: u.raw.denominator }];
    }),
  );
}

function pooled(p: RunParameter): { numerator: number; denominator: number } {
  if (p.raw?.kind !== 'ratio') throw new Error('not a ratio');
  return { numerator: p.raw.numerator, denominator: p.raw.denominator };
}

// ---- 4.1 ------------------------------------------------------------------------------------

const PY = 'packages/api/api/funcs.py';
const complexipyEntries = [
  { function_name: 'flat15', complexity: 15 },
  { function_name: 'flat16', complexity: 16 },
  { function_name: 'trivial', complexity: 0 },
  { function_name: 'Box::method', complexity: 1 },
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ function_name: `t${i}`, complexity: 0 })),
].map((e) => ({ path: PY, file_name: 'funcs.py', ...e }));

interface Call {
  args: string[];
  cwd: string;
}

function fakeComplexipy(calls: Call[] = [], entries: unknown[] = complexipyEntries): FakeTool {
  return (args, cwd) => {
    calls.push({ args, cwd });
    writeFileSync(args[args.indexOf('--output') + 1] as string, JSON.stringify(entries));
    return ok();
  };
}

describe('4.1 complex functions', () => {
  it('counts functions over 15 in TS (real eslint) and Python (complexipy output) and pools them', async () => {
    const want = expected('d4-complexity') as never as Record<string, Record<string, never>>;
    const calls: Call[] = [];
    const run = await scan(
      materializeFixture('d4-complexity'),
      fakeToolKit({ complexipy: fakeComplexipy(calls), vulture: () => ok() }, { versions: { complexipy: '5.1.0' } }),
    );
    const p = param(run, '4.1');
    expect(p.status).toBe('measured');
    expect(unitRatios(p)).toEqual({ web: want.p41?.web, api: want.p41?.api });
    expect(pooled(p)).toEqual(want.p41?.pooled);
    expect(p.score).toBeCloseTo(Number(want.p41?.score), 3);
    expect(run.warnings).toContain('4.1: 1 files could not be parsed');
    expect(run.reportOnly?.complexityByFile).toEqual(want.complexityByFile);
    expect(run.tools.static).toMatchObject({
      complexipy: '5.1.0',
      eslint: expect.stringMatching(/^\d/) as string,
      'eslint-plugin-sonarjs': expect.stringMatching(/^\d/) as string,
      '@typescript-eslint/parser': expect.stringMatching(/^\d/) as string,
    });
  });

  it('runs complexipy with the YAML threshold and no repository config in its work copy', async () => {
    const calls: Call[] = [];
    await scan(materializeFixture('d4-complexity'), fakeToolKit({ complexipy: fakeComplexipy(calls), vulture: () => ok() }));
    expect(calls).toHaveLength(1);
    const { args } = calls[0] as Call;
    expect(args.slice(0, 5)).toEqual(['.', '--max-complexity-allowed', '15', '--no-ignore', '--ignore-complexity']);
    expect(args).toContain('--quiet');
  });

  it('ignores complexipy entries for files outside the logic set', async () => {
    const extra = [{ path: 'elsewhere/x.py', file_name: 'x.py', function_name: 'z', complexity: 99 }];
    const run = await scan(
      materializeFixture('d4-complexity'),
      fakeToolKit({ complexipy: fakeComplexipy([], [...complexipyEntries, ...extra]), vulture: () => ok() }),
    );
    expect(pooled(param(run, '4.1'))).toEqual({ numerator: 2, denominator: 20 });
  });

  it('is not_measured with the tool name when complexipy is missing, and 4.3 still scores', async () => {
    const run = await scan(materializeFixture('d4-complexity'), fakeToolKit({ complexipy: null, vulture: () => ok() }));
    const p = param(run, '4.1');
    expect(p.status).toBe('not_measured');
    expect(p.reason).toMatch(/^complexipy not found, install: pipx install complexipy/);
    expect(param(run, '4.3').status).toBe('measured');
    expect(run.dimensions.find((d) => d.id === 4)?.score).not.toBeNull();
  });

  // complexipy 7.x and 8.x exit 1 when a function is over the threshold, --ignore-complexity or not, and still write the report.
  function exitOne(stdout = ''): FakeTool {
    return (args) => {
      writeFileSync(args[args.indexOf('--output') + 1] as string, JSON.stringify(complexipyEntries));
      return ok(stdout, 1);
    };
  }

  it('reads the report when complexipy exits 1 for a function over the threshold', async () => {
    const want = expected('d4-complexity') as never as Record<string, Record<string, never>>;
    const run = await scan(materializeFixture('d4-complexity'), fakeToolKit({ complexipy: exitOne(), vulture: () => ok() }));
    const p = param(run, '4.1');
    expect(p.status).toBe('measured');
    expect(pooled(p)).toEqual(want.p41?.pooled);
    expect(run.warnings).toContain('4.1: 1 files could not be parsed');
  });

  it('counts Python files complexipy could not parse together with the TS ones', async () => {
    const stdout = '\x1b[31merror\x1b[39m: Failed to process /tmp/x/broken.py - Please check file/folder exists or check syntax\n';
    const run = await scan(materializeFixture('d4-complexity'), fakeToolKit({ complexipy: exitOne(stdout), vulture: () => ok() }));
    expect(param(run, '4.1').status).toBe('measured');
    expect(run.warnings).toContain('4.1: 2 files could not be parsed');
  });

  it.each([
    ['exits with a failure code', (): FakeTool => () => ({ exitCode: 2, stdout: '', stderr: 'boom', timedOut: false }), /^complexipy exited with 2: boom/],
    ['prints no report', (): FakeTool => () => ok(), /^complexipy printed no parseable JSON report/],
    ['exits 1 with no report', (): FakeTool => () => ok('', 1), /^complexipy printed no parseable JSON report/],
    ['writes an unexpected shape', (): FakeTool => (args) => {
      writeFileSync(args[args.indexOf('--output') + 1] as string, JSON.stringify([{ path: PY }]));
      return ok();
    }, /^complexipy report has an unexpected shape/],
    ['cannot start', (): FakeTool => () => ({ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' }), /^complexipy could not start: ENOENT/],
    ['times out', (): FakeTool => () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }), /^complexipy timed out/],
  ])('is not_measured, never 0, when complexipy %s', async (_name, make, reason) => {
    const run = await scan(materializeFixture('d4-complexity'), fakeToolKit({ complexipy: make(), vulture: () => ok() }));
    const p = param(run, '4.1');
    expect(p.status).toBe('not_measured');
    expect(p.reason).toMatch(reason);
    expect(p.score).toBeUndefined();
  });

  it('names the missing tool in the printed summary', async () => {
    const run = await scan(materializeFixture('d4-complexity'), fakeToolKit({ complexipy: null, vulture: () => ok() }));
    expect(summarize(run, methodology)).toMatch(/^4\.1 Complex functions: not measured \(complexipy not found, install: /m);
  });

  it('is a valid, not comparable full run when a tool is missing', async () => {
    const run = await scan(materializeFixture('d4-complexity'), fakeToolKit({ complexipy: null, vulture: () => ok() }), 'full');
    expect(run.valid).toBe(true);
    expect(run.parameters.find((p) => p.id === '4.1')).toMatchObject({ status: 'not_measured', reason: expect.stringMatching(/^complexipy not found/) });
    expect(run.comparable).toBe(false);
    expect(run.comparableReason).toMatch(/4\.1 \(complexipy not found/);
  });

  it('does not resolve Python tools for a TypeScript-only repository', async () => {
    const kit = fakeToolKit();
    const run = await scan(materializeFixture('typescript'), kit);
    expect(kit.resolved).not.toContain('complexipy');
    expect(kit.resolved).not.toContain('vulture');
    expect(param(run, '4.1').status).toBe('measured');
    expect(param(run, '4.4').status).toBe('measured');
  });
});

// ---- 4.3 ------------------------------------------------------------------------------------

describe('4.3 duplication', () => {
  it('reproduces the hand-counted duplicated lines with real jscpd', async () => {
    const want = expected('d4-duplication') as never as Record<string, Record<string, never>>;
    const kit = fakeToolKit({ complexipy: fakeComplexipy(), vulture: () => ok() });
    const run = await scan(materializeFixture('d4-duplication'), kit);
    const p = param(run, '4.3');
    expect(p.status).toBe('measured');
    expect(unitRatios(p)).toEqual({ web: want.p43?.web, api: want.p43?.api });
    expect(pooled(p)).toEqual(want.p43?.pooled);
    expect(p.score).toBeCloseTo(Number(want.p43?.score), 3);
    expect(run.tools.static?.jscpd).toMatch(/^\d/);
  });

  it('counts each clone once, as jscpd duplicatedLines does', async () => {
    const want = expected('d4-duplication-once') as never as Record<string, Record<string, never>>;
    const run = await scan(materializeFixture('d4-duplication-once'), fakeToolKit({ complexipy: fakeComplexipy(), vulture: () => ok() }));
    const p = param(run, '4.3');
    expect(p.status).toBe('measured');
    expect(pooled(p)).toEqual(want.p43?.pooled);
    expect(p.score).toBeCloseTo(Number(want.p43?.score), 3);
  });

  it('is not_measured with the tool name when jscpd is missing', async () => {
    const run = await scan(materializeFixture('d4-duplication'), fakeToolKit({ jscpd: null, complexipy: fakeComplexipy(), vulture: () => ok() }));
    const p = param(run, '4.3');
    expect(p.status).toBe('not_measured');
    expect(p.reason).toMatch(/^jscpd not found, install:/);
  });
});

// ---- 4.4 ------------------------------------------------------------------------------------

const CORE = 'packages/api/api/core.py';
const DEAD = 'packages/api/api/dead_module.py';
const vultureOutput = [
  `${CORE}:1: unused variable '__all__' (60% confidence)`,
  `${CORE}:12: unused function 'unused_fn' (60% confidence)`,
  `${CORE}:12: unused function 'unused_fn' (60% confidence)`,
  `${CORE}:16: unused class 'UnusedClass' (60% confidence)`,
  `${CORE}:17: unused method 'unused_method' (60% confidence)`,
  `${CORE}:21: unused function 'decorated_fn' (60% confidence)`,
  `${CORE}:22: unused function 'decorated_fn' (60% confidence)`,
  `${CORE}:26: unused function 'exported_fn' (60% confidence)`,
  // Real vulture reports the [project.scripts] target too (`api-cli = "api.cli:cli"`); it counts as used.
  "packages/api/api/cli.py:1: unused function 'cli' (60% confidence)",
  `${DEAD}:1: unused function 'dm1' (60% confidence)`,
  `${DEAD}:5: unused function 'dm2' (60% confidence)`,
  'packages/api/tests/test_app.py:9: unused function \'helper\' (60% confidence)',
  'not a vulture line',
].join('\n');

interface VultureCall extends Call {
  hasRepoConfig: boolean;
  hasTestFile: boolean;
}

function fakeVulture(calls: VultureCall[] = [], stdout = vultureOutput, exitCode = 3): FakeTool {
  return (args, cwd) => {
    calls.push({
      args,
      cwd,
      hasRepoConfig: existsSync(path.join(cwd, 'packages/api/pyproject.toml')),
      hasTestFile: existsSync(path.join(cwd, 'packages/api/tests/test_app.py')),
    });
    return ok(stdout, exitCode);
  };
}

const deadKit = (vulture: FakeTool | null = fakeVulture()): FakeKit => fakeToolKit({ complexipy: fakeComplexipy(), vulture });

describe('4.4 unused exports and files', () => {
  it('reproduces the hand counts for TypeScript (real knip) and Python (canned vulture)', async () => {
    const want = expected('d4-deadcode') as never as Record<string, Record<string, never>>;
    const calls: VultureCall[] = [];
    const run = await scan(materializeFixture('d4-deadcode'), deadKit(fakeVulture(calls)));
    const p = param(run, '4.4');
    expect(p.status).toBe('measured');
    expect(unitRatios(p)).toEqual({ web: want.p44?.web, api: want.p44?.api });
    expect(pooled(p)).toEqual(want.p44?.pooled);
    expect(p.score).toBeCloseTo(Number(want.p44?.score), 3);
    expect(run.tools.static?.knip).toMatch(/^\d/);
    expect(run.tools.static?.vulture).toBe('0.0.0-fake');

    expect(calls).toHaveLength(1);
    expect((calls[0] as VultureCall).args).toEqual(['.', '--min-confidence', '60']);
    // The work copy has the unit's test files (so test use counts) and no repository config.
    expect((calls[0] as VultureCall).hasTestFile).toBe(true);
    expect((calls[0] as VultureCall).hasRepoConfig).toBe(false);
  });

  it('reads the knip report when a config knip loads prints a dotenv banner first', async () => {
    const want = expected('d4-deadcode') as never as Record<string, Record<string, never>>;
    const real = createToolKit();
    const knip = await real.resolve('knip');
    if (!knip) throw new Error('knip not installed');
    const envs: (Record<string, string> | undefined)[] = [];
    const bannerKnip: FakeTool = async (args, cwd, env) => {
      envs.push(env);
      const result = await real.run(knip, args, { cwd, env });
      return { ...result, stdout: `◇ injected env (13) from .env // tip: ⌘ suppress logs { quiet: true }\n${result.stdout}` };
    };
    const run = await scan(
      materializeFixture('d4-deadcode'),
      fakeToolKit({ knip: bannerKnip, complexipy: fakeComplexipy(), vulture: fakeVulture() }),
    );
    const p = param(run, '4.4');
    expect(p.status).toBe('measured');
    expect(unitRatios(p)).toEqual({ web: want.p44?.web, api: want.p44?.api });
    expect(envs).toEqual([{ DOTENV_CONFIG_QUIET: 'true' }]);
  });

  it('reproduces D4 as a complete score in a preview run, and recompute agrees', async () => {
    const run = await scan(materializeFixture('d4-complexity'), fakeToolKit({ complexipy: fakeComplexipy(), vulture: fakeVulture([], '', 0) }));
    for (const id of ['4.1', '4.2', '4.3', '4.4']) expect(param(run, id).status).toBe('measured');
    expect(run.dimensions.find((d) => d.id === 4)?.score).not.toBeNull();
    const again = recompute(run, methodology);
    expect(again.parameters).toEqual(run.parameters);
    expect(again.dimensions).toEqual(run.dimensions);
  });

  it('redistributes weight when one tool is unavailable and D4 still scores', async () => {
    const full = await scan(materializeFixture('d4-deadcode'), deadKit());
    const missing = await scan(materializeFixture('d4-deadcode'), deadKit(null));
    expect(param(missing, '4.4').status).toBe('not_measured');
    expect(param(missing, '4.4').reason).toMatch(/^vulture not found, install: pipx install vulture/);
    const weights = new Map(methodology.dimensions.flatMap((d) => d.parameters).map((def) => [def.id, def.weight]));
    const ids = ['4.1', '4.2', '4.3'];
    const total = ids.reduce((sum, id) => sum + (weights.get(id) ?? 0), 0);
    const weighted = ids.reduce((sum, id) => sum + (param(missing, id).score ?? 0) * (weights.get(id) ?? 0), 0) / total;
    expect(missing.dimensions.find((d) => d.id === 4)?.score).toBeCloseTo(weighted, 6);
    expect(full.dimensions.find((d) => d.id === 4)?.score).not.toBeCloseTo(weighted, 3);
  });

  it('is not_measured when vulture exits with an unexpected code', async () => {
    const run = await scan(materializeFixture('d4-deadcode'), deadKit(fakeVulture([], '', 2)));
    expect(param(run, '4.4').status).toBe('not_measured');
    expect(param(run, '4.4').reason).toMatch(/^vulture exited with 2/);
  });

  it('counts a Python module and symbols the way the YAML defines them', async () => {
    const tracked = {
      // Not a distributed package and no [project.scripts]: __all__ no longer protects exported_fn, cli.py is unused.
      'packages/api/pyproject.toml': '[tool.other]\nx = 1\n',
      // A package imported by name marks its __init__ (a logic file here), a relative import marks a sibling, an orphan stays unused.
      'packages/api/api/sub/__init__.py': 'def pkg_fn():\n    return 0\n',
      'packages/api/api/sub/user.py': 'from . import helper\n\n\ndef u():\n    return helper.h()\n',
      'packages/api/api/sub/helper.py': 'def h():\n    return 1\n',
      'packages/api/api/sub/orphan.py': 'def o():\n    return 1\n',
      'packages/api/tests/test_sub.py': 'from api.sub import user\n\nuser.u()\n',
      // Entry modules are never unused.
      'packages/api/api/settings/dev.py': 'def s():\n    return 1\n',
      'packages/api/api/views.py': 'def v():\n    return 1\n',
      'packages/api/tests/test_bad.py': 'def (:\n',
    };
    const run = await scan(materializeFixture('d4-deadcode', {}, tracked), deadKit());
    // core: 4 hits kept (exported_fn is no longer protected), dead_module 2, cli 1 (no script), sub/orphan 1.
    // Symbols: 12 + pkg_fn, u, h, o, s, v.
    expect(unitRatios(param(run, '4.4')).api).toEqual({ numerator: 8, denominator: 18 });
    expect(run.warnings).toContain('4.4: 1 Python files could not be parsed');
  });

  it('treats framework hooks and overrides of repository base methods as used', async () => {
    const want = expected('d4-deadcode-callbacks') as never as { vulture: string[]; p44: Record<string, never> };
    const run = await scan(materializeFixture('d4-deadcode-callbacks'), deadKit(fakeVulture([], want.vulture.join('\n'))));
    const p = param(run, '4.4');
    expect(p.status).toBe('measured');
    expect(unitRatios(p)).toEqual({ core: want.p44.core, app: want.p44.app });
    expect(pooled(p)).toEqual(want.p44.pooled);
    expect(p.score).toBeCloseTo(Number(want.p44.score), 3);
  });

  it('warns about invalid TOML and treats the package as not distributed', async () => {
    const run = await scan(materializeFixture('d4-deadcode', {}, { 'packages/api/pyproject.toml': '[project\n' }), deadKit());
    expect(run.warnings).toContain('packages/api/pyproject.toml: invalid TOML, ignored');
  });
});
