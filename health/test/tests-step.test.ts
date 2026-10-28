import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { planExecution } from '../src/exec/plan.js';
import { coveredLines, parseCoverageRanges } from '../src/exec/test-reports/coverage-ranges.js';
import { parseCoveragePy } from '../src/exec/test-reports/coverage-py.js';
import { parseCoverageSummary } from '../src/exec/test-reports/coverage-summary.js';
import { parseJestJson } from '../src/exec/test-reports/jest-json.js';
import { parseJunit } from '../src/exec/test-reports/junit.js';
import { parseMochaJson } from '../src/exec/test-reports/mocha-json.js';
import { detectInvocations, jsRunner, logicGlobs, pythonTargets } from '../src/exec/test-runners/detect.js';
import { RUNNERS } from '../src/exec/test-runners/index.js';
import { runnerInScript, scriptArgs } from '../src/exec/test-runners/script.js';
import type { StepSpec, TestRunnerName } from '../src/exec/types.js';
import { p11 } from '../src/measure/p1-1.js';
import { p12 } from '../src/measure/p1-2.js';
import { p13 } from '../src/measure/p1-3.js';
import { p21 } from '../src/measure/p2-1.js';
import { p25 } from '../src/measure/p2-5.js';
import { p61 } from '../src/measure/p6-1.js';
import { p63 } from '../src/measure/p6-3.js';
import { measurers } from '../src/measure/registry.js';
import { loadMethodology } from '../src/methodology/load.js';
import { runScan } from '../src/run/scan.js';
import type { RunFile } from '../src/run/schema.js';
import { analyzeTsFile } from '../src/scope/ts-lines.js';
import { buildScope } from '../src/scope/build.js';
import { trackedPaths } from '../src/scope/tracked.js';
import { ToolError } from '../src/scope/types.js';
import { fixturesDir, materializeFixture } from './helpers/fixture.js';
import { FAKE_DIGEST, fakeRunner, type FakeStep } from './helpers/exec.js';
import { fakeToolKit, ok, type FakeTool } from './helpers/tools.js';

const methodology = loadMethodology('1.0');
const testMeasurers = [p11, p12, p13, p63, p21, p25, p61];

interface Expected {
  logicLines: number;
  cases?: { passed: number; failed: number; skipped: number };
  p11: { numerator?: number; denominator?: number; score: number };
  p12: { numerator?: number; denominator?: number; score: number };
  p13: { numerator?: number; denominator?: number; score: number };
  p63?: { status: string; score: number };
}
const expected = (name: string) => JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Expected;

/** The files of one stored report set, named as the real run writes them under /out. */
function reportFiles(runner: string): Record<string, string> {
  const dir = path.join(fixturesDir, 'reports', runner);
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, full)] = readFileSync(full, 'utf8');
  }
  return files;
}

function runnerOf(spec: StepSpec): TestRunnerName {
  const argv = spec.argv.join(' ');
  if (spec.argv[0] === 'health-pytest') return 'pytest';
  if (argv.includes('node --test')) return 'node-test';
  for (const name of ['vitest', 'jest', 'mocha'] as const) if (spec.argv.includes(name)) return name;
  throw new Error(`no runner in ${argv}`);
}

/** Install, typecheck and lint work; the test step writes the stored reports of its runner unless `test` overrides it. */
function healthy(test?: (spec: StepSpec, runner: TestRunnerName) => FakeStep | undefined) {
  return fakeRunner((spec) => {
    if (spec.step === 'typecheck') return { exitCode: 0, files: { 'tsc.txt': '', 'pyright.json': '{"generalDiagnostics":[]}', 'mypy.txt': '' } };
    if (spec.step === 'lint') return { exitCode: 0, files: { 'eslint.json': '[]', 'ruff.json': '[]' } };
    if (spec.step === 'knip') return { exitCode: 0, files: { 'knip.json': '{"issues":[]}' } };
    if (spec.step === 'test') {
      const runner = runnerOf(spec);
      return test?.(spec, runner) ?? { exitCode: 1, files: reportFiles(runner) };
    }
    return { exitCode: 0 };
  });
}

const opts = (repoPath: string, execRunner: ReturnType<typeof fakeRunner>, over: Partial<Parameters<typeof runScan>[0]> = {}) => ({
  repoPath,
  methodologyVersion: '1.0',
  mode: 'full' as const,
  asOf: '2026-10-04',
  tools: fakeToolKit(),
  execRunner,
  imageDigest: FAKE_DIGEST,
  measurers: testMeasurers,
  ...over,
});
const param = (result: RunFile, id: string) => {
  const found = result.parameters.find((p) => p.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe('report parsers', () => {
  it('counts jest and vitest assertions, and a file that did not load as one failed case', () => {
    expect(parseJestJson(reportFiles('vitest')['results.json'] as string)).toEqual({ passed: 2, failed: 1, errored: 0, skipped: 1 });
    const broken = JSON.stringify({ testResults: [{ status: 'failed', assertionResults: [] }, { status: 'passed', assertionResults: [{ status: 'passed' }, { status: 'todo' }, { status: 'pending' }] }] });
    expect(parseJestJson(broken)).toEqual({ passed: 1, failed: 1, errored: 0, skipped: 2 });
    expect(parseJestJson('nope')).toBeNull();
    expect(parseJestJson('{}')).toBeNull();
  });

  it('counts mocha passes, failures and pending, and rejects text that is not a report', () => {
    expect(parseMochaJson(reportFiles('mocha')['results.json'] as string)).toEqual({ passed: 2, failed: 1, errored: 0, skipped: 1 });
    expect(parseMochaJson('Error: Cannot find module')).toBeNull();
  });

  it('counts JUnit cases, leaves pytest xfail out and counts a collection error as errored', () => {
    expect(parseJunit(reportFiles('pytest')['junit.xml'] as string)).toEqual({ passed: 2, failed: 1, errored: 0, skipped: 1 });
    expect(parseJunit(reportFiles('node-test')['junit.xml'] as string)).toEqual({ passed: 2, failed: 1, errored: 0, skipped: 1 });
    const collection = '<testsuites><testsuite><testcase classname="" name="tests.test_x"><error message="collection failure">ImportError</error></testcase></testsuite></testsuites>';
    expect(parseJunit(collection)).toEqual({ passed: 0, failed: 0, errored: 1, skipped: 0 });
    expect(parseJunit('no xml')).toBeNull();
  });

  it('maps coverage paths to repo-relative paths and skips the total', () => {
    const summary = parseCoverageSummary(reportFiles('vitest')['coverage/coverage-summary.json'] as string, '.');
    expect([...(summary?.keys() ?? [])]).toEqual(['src/math.js', 'src/unused.js']);
    expect(summary?.get('src/math.js')).toEqual({ lines: { total: 4, covered: 3 }, branches: { total: 4, covered: 3 } });
    expect(parseCoverageSummary('{"/work/pkg/a.js":{"lines":{"total":1,"covered":1}}}', 'pkg')).toBeNull();
    expect([...(parseCoverageSummary('{"total":{},"/work/pkg/a.js":{"lines":{"total":2,"covered":1}}}', 'pkg')?.keys() ?? [])]).toEqual(['pkg/a.js']);
    const py = parseCoveragePy(reportFiles('pytest')['coverage.json'] as string, 'api');
    expect(py?.get('api/calc/ops.py')).toEqual({ lines: { total: 8, covered: 7 }, branches: { total: 4, covered: 3 } });
    expect(parseCoveragePy('[]', '.')).toBeNull();
  });
});

describe('1.2 line counting', () => {
  const math = 'export function add(a, b) {\n  return a + b;\n}\nexport function clamp(n, lo, hi) {\n  if (n < lo) return lo;\n  if (n > hi) return hi;\n  return n;\n}\n';
  const count = (runner: string) => {
    const ranges = parseCoverageRanges(reportFiles(runner)['coverage/coverage-final.json'] as string, '.')?.get('src/math.js') ?? [];
    return coveredLines(analyzeTsFile('src/math.js', math).codeLineNumbers, ranges).size;
  };

  it('gives the same covered and coverable lines for vitest 4, c8 and the jest v8 provider on the same code', () => {
    expect(analyzeTsFile('src/math.js', math).codeLines).toBe(8);
    expect(count('vitest')).toBe(7);
    expect(count('mocha')).toBe(7);
    expect(count('node-test')).toBe(7);
  });

  it('maps coverage-final.json paths to repo-relative paths and rejects text that is not that report', () => {
    const parsed = parseCoverageRanges(reportFiles('vitest')['coverage/coverage-final.json'] as string, 'pkg');
    expect([...(parsed?.keys() ?? [])]).toEqual(['src/math.js', 'src/unused.js']);
    expect([...(parseCoverageRanges('{"a.js":{"statementMap":{}}}', 'pkg')?.keys() ?? [])]).toEqual(['pkg/a.js']);
    expect(parseCoverageRanges('nope', '.')).toBeNull();
    expect(parseCoverageRanges('[]', '.')).toBeNull();
  });

  it('uses the innermost range, and counts a line outside every range as covered only when the file ran', () => {
    const ranges = [{ start: 1, end: 5, hits: 3 }, { start: 3, end: 3, hits: 0 }];
    expect([...coveredLines([1, 2, 3, 4, 9], ranges)]).toEqual([1, 2, 4, 9]);
    expect([...coveredLines([1, 9], [{ start: 1, end: 1, hits: 0 }])]).toEqual([]);
  });
});

describe('runner detection', () => {
  it('lets the test script win, then falls back to vitest, jest, mocha dependencies', () => {
    const pkg = (scripts: Record<string, string>, deps: string[] = []) => JSON.stringify({ scripts, devDependencies: Object.fromEntries(deps.map((d) => [d, '1'])) });
    expect(jsRunner(pkg({ test: 'jest --silent' }, ['vitest', 'jest']))?.runner).toBe('jest');
    expect(jsRunner(pkg({ test: 'node --test test/' }))?.runner).toBe('node-test');
    expect(jsRunner(pkg({ test: 'echo hi' }, ['mocha', 'jest']))?.runner).toBe('jest');
    expect(jsRunner(pkg({}, ['mocha']))?.runner).toBe('mocha');
    expect(jsRunner(pkg({ test: 'playwright test' }, ['@playwright/test']))).toBeNull();
    expect(jsRunner(null)).toBeNull();
    expect(runnerInScript('mocha && jest')).toBe('mocha');
  });

  it('keeps config and path arguments of the script and drops watch, reporter and coverage options', () => {
    expect(scriptArgs('vitest --config vitest.unit.config.ts --watch --reporter dot --coverage', 'vitest')).toEqual(['--config', 'vitest.unit.config.ts']);
    expect(scriptArgs('vitest run --dir src && tsc --noEmit', 'vitest')).toEqual(['--dir', 'src']);
    expect(scriptArgs('lint && jest --ci --coverage.enabled --projects a b', 'jest')).toEqual(['--projects', 'a', 'b']);
    expect(scriptArgs('c8 mocha -R spec "test/**/*.js"', 'mocha')).toEqual(['"test/**/*.js"']);
    expect(scriptArgs('node --test --test-reporter=spec test/', 'node-test')).toEqual(['--test-reporter=spec', 'test/']);
    expect(scriptArgs('echo hi', 'jest')).toEqual([]);
  });

  it('plans one invocation per install root, or per workspace member when the root declares none', async () => {
    const files = {
      'package.json': '{"workspaces":["packages/*"]}\n',
      'packages/a/package.json': '{"scripts":{"test":"vitest run"}}\n',
      'packages/a/index.js': 'export function a() {\n  return 1;\n}\n',
      'packages/b/package.json': '{}\n',
      'packages/b/index.js': 'export function b() {\n  return 1;\n}\n',
      'api/pyproject.toml': '[project]\nname = "api"\n',
      'api/main.py': 'def main():\n    return 1\n',
      'api/tests/test_main.py': 'def test_main():\n    assert True\n',
    };
    const dir = materializeFixture('blank', {}, files);
    const scope = await buildScope(dir, methodology);
    const tracked = trackedPaths(dir);
    const plan = planExecution(scope, tracked);
    const read = (rel: string) => files[rel as keyof typeof files] ?? null;
    const found = detectInvocations({ roots: plan.roots, scope, tracked: new Set(tracked), read });
    expect(found.map((i) => [i.dir, i.runner])).toEqual([
      ['packages/a', 'vitest'],
      ['api', 'pytest'],
    ]);
  });

  it('builds directory-level globs and pytest cov targets', () => {
    expect(logicGlobs(['src/a.ts', 'src/b/c.ts', 'index.js'], '.')).toEqual(['index.js', 'src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']);
    expect(logicGlobs(['pkg/src/a.ts'], 'pkg')).toEqual(['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']);
    expect(pythonTargets(['api/calc/ops.py', 'api/main.py'], 'api')).toEqual(['calc', 'main']);
  });

  it('puts the report and coverage flags of each runner in its argv', () => {
    const inv = (runner: TestRunnerName, args: string[] = []) => ({ dir: '.', group: 'typescript_javascript' as const, runner, args });
    const globs = ['src/**/*.js'];
    const v = RUNNERS.vitest.argv(inv('vitest', ['--config', 'x.ts']), globs, []);
    expect(v).toEqual(expect.arrayContaining(['--reporter=json', '--outputFile=/out/results.json', '--coverage.provider=v8', '--coverage.reporter=json-summary', '--coverage.reporter=json', '--coverage.reportOnFailure', '--coverage.include=src/**/*.js', '--config', 'x.ts']));
    expect(RUNNERS.jest.argv(inv('jest'), globs, [])).toEqual(expect.arrayContaining(['--json', '--coverageProvider=v8', '--coverageReporters=json-summary', '--coverageReporters=json', '--collectCoverageFrom=src/**/*.js', '--coverageThreshold={}']));
    expect(RUNNERS.mocha.argv(inv('mocha'), globs, []).slice(0, 8)).toEqual(['c8', '--reporter=json-summary', '--reporter=json', '--report-dir=/out/coverage', '--all', '--include', 'src/**/*.js', 'npx']);
    expect(RUNNERS['node-test'].argv(inv('node-test'), globs, [])).toEqual(expect.arrayContaining(['--test-reporter=junit', '--test-reporter-destination=/out/junit.xml', 'node', '--test']));
    expect(RUNNERS.pytest.argv(inv('pytest'), [], ['calc'])).toEqual(['health-pytest', '--continue-on-collection-errors', '--junitxml=/out/junit.xml', '--cov=calc', '--cov-branch', '--cov-report=json:/out/coverage.json', '--cov-fail-under=0']);
  });
});

describe('fixtures per runner', () => {
  const cases: [string, TestRunnerName][] = [
    ['exec-tests-vitest', 'vitest'],
    ['exec-tests-jest', 'jest'],
    ['exec-tests-mocha', 'mocha'],
    ['exec-tests-node-test', 'node-test'],
    ['exec-tests-pytest', 'pytest'],
    ['exec-tests-unittest', 'pytest'],
    ['exec-tests-tox', 'pytest'],
    ['exec-tests-nox', 'pytest'],
  ];
  it.each(cases)('%s gives the hand-counted pass rate and coverage', async (name, runner) => {
    const want = expected(name);
    const fake = healthy();
    const result = await runScan(opts(materializeFixture(name), fake));
    const testSpecs = fake.specs.filter((s) => s.step === 'test');
    expect(testSpecs).toHaveLength(1);
    expect(runnerOf(testSpecs[0] as StepSpec)).toBe(runner);
    expect(fake.specs.some((s) => s.step === 'coverage-install')).toBe(name === 'exec-tests-vitest');

    expect(param(result, '1.1').raw).toEqual({ kind: 'ratio', numerator: want.p11.numerator, denominator: want.p11.denominator, scale: 100 });
    expect(param(result, '1.2').raw).toEqual({ kind: 'ratio', numerator: want.p12.numerator, denominator: want.p12.denominator, scale: 100 });
    expect(param(result, '1.3').raw).toEqual({ kind: 'ratio', numerator: want.p13.numerator, denominator: want.p13.denominator, scale: 100 });
    expect(param(result, '1.1').score).toBeCloseTo(want.p11.score, 4);
    expect(param(result, '1.2').score).toBeCloseTo(want.p12.score, 4);
    expect(param(result, '1.3').score).toBeCloseTo(want.p13.score, 4);
    expect(result.warnings.filter((w) => /missing from the coverage report/.test(w))).toEqual([]);
  });

  it('makes the unittest, tox and nox fixtures run through pytest', () => {
    for (const name of ['exec-tests-unittest', 'exec-tests-tox', 'exec-tests-nox']) {
      const files = readdirSync(path.join(fixturesDir, name), { recursive: true }).map(String);
      expect(files).toContain(path.join('tests', 'test_ops.py'));
    }
  });
});

describe('no tests, timeouts and tool errors', () => {
  it('scores 1.1 to 1.3 as 0, never not applicable, and fails 6.3, when there is no test', async () => {
    const fake = healthy();
    const result = await runScan(opts(materializeFixture('exec-tests-none'), fake));
    expect(fake.specs.some((s) => s.step === 'test')).toBe(false);
    for (const id of ['1.1', '1.2', '1.3']) expect(param(result, id)).toMatchObject({ status: 'measured', score: 0, raw: null });
    expect(param(result, '6.3')).toMatchObject({ status: 'failed', score: 0 });
    expect(expected('exec-tests-none').p63).toEqual({ status: 'failed', score: 0 });
  });

  it('scores a runner that ran zero cases as 0 and fails 6.3', async () => {
    const empty = healthy(() => ({ exitCode: 0, files: { 'results.json': '{"testResults":[]}' } }));
    const result = await runScan(opts(materializeFixture('exec-tests-vitest'), empty));
    for (const id of ['1.1', '1.2', '1.3']) expect(param(result, id)).toMatchObject({ status: 'measured', score: 0 });
    expect(param(result, '6.3').status).toBe('failed');
  });

  it('scores 1.1 to 1.3 and 6.3 at 0 when the test step times out', async () => {
    const result = await runScan(opts(materializeFixture('exec-tests-vitest'), healthy(() => ({ exitCode: 0, timeout: true }))));
    for (const id of ['1.1', '1.2', '1.3', '6.3']) expect(param(result, id)).toMatchObject({ status: 'failed', score: 0 });
    expect(param(result, '1.1').reason).toMatch(/timed out/);
  });

  it('scores 0 when the run exits without a usable results report', async () => {
    const result = await runScan(opts(materializeFixture('exec-tests-mocha'), healthy(() => ({ exitCode: 1, files: { 'results.json': 'Error: Cannot find module' } }))));
    for (const id of ['1.1', '1.2', '1.3', '6.3']) expect(param(result, id)).toMatchObject({ status: 'failed', score: 0 });
  });

  it('zeroes all four when install fails', async () => {
    const fake = fakeRunner((spec) => ({ exitCode: spec.step === 'install' ? 1 : 0 }));
    const result = await runScan(opts(materializeFixture('exec-tests-vitest'), fake));
    for (const id of ['1.1', '1.2', '1.3', '6.3']) expect(param(result, id)).toMatchObject({ status: 'failed', score: 0 });
    expect(fake.specs.map((s) => s.step)).toEqual(['install']);
  });

  it('is a tool error when results exist but coverage is missing or unreadable', async () => {
    const results = reportFiles('vitest')['results.json'] as string;
    await expect(runScan(opts(materializeFixture('exec-tests-vitest'), healthy(() => ({ exitCode: 0, files: { 'results.json': results } }))))).rejects.toBeInstanceOf(ToolError);
    await expect(runScan(opts(materializeFixture('exec-tests-vitest'), healthy(() => ({ exitCode: 0, files: { 'results.json': results, 'coverage/coverage-summary.json': 'garbage' } }))))).rejects.toThrow(/no usable coverage data/);
    const summary = reportFiles('vitest')['coverage/coverage-summary.json'] as string;
    await expect(runScan(opts(materializeFixture('exec-tests-vitest'), healthy(() => ({ exitCode: 0, files: { 'results.json': results, 'coverage/coverage-summary.json': summary } }))))).rejects.toThrow(/no usable coverage-final.json/);
  });

  it('is a tool error when the coverage provider cannot be installed, and exits 4 through the CLI', async () => {
    const failing = fakeRunner((spec) => ({ exitCode: spec.step === 'coverage-install' ? 1 : 0 }));
    await expect(runScan(opts(materializeFixture('exec-tests-vitest'), failing))).rejects.toThrow(/coverage provider/);
  });

  it('counts a logic file the coverage report lacks as 0% covered and says so once', async () => {
    const files = reportFiles('vitest');
    const summary = JSON.parse(files['coverage/coverage-summary.json'] as string) as Record<string, unknown>;
    delete summary['/work/src/unused.js'];
    const final = JSON.parse(files['coverage/coverage-final.json'] as string) as Record<string, unknown>;
    delete final['/work/src/unused.js'];
    const runner = healthy(() => ({ exitCode: 1, files: { ...files, 'coverage/coverage-summary.json': JSON.stringify(summary), 'coverage/coverage-final.json': JSON.stringify(final) } }));
    const result = await runScan(opts(materializeFixture('exec-tests-vitest'), runner));
    expect(param(result, '1.2').raw).toEqual({ kind: 'ratio', numerator: 7, denominator: 11, scale: 100 });
    expect(param(result, '1.3').raw).toEqual({ kind: 'ratio', numerator: 3, denominator: 4, scale: 100 });
    expect(result.warnings.filter((w) => /1 logic file\(s\) missing/.test(w))).toHaveLength(1);
  });

  it('drops coverage entries outside the logic set', async () => {
    const files = reportFiles('vitest');
    const summary = JSON.parse(files['coverage/coverage-summary.json'] as string) as Record<string, unknown>;
    summary['/work/test/math.test.js'] = summary['/work/src/math.js'];
    summary['/work/node_modules/x/index.js'] = summary['/work/src/math.js'];
    const final = JSON.parse(files['coverage/coverage-final.json'] as string) as Record<string, unknown>;
    final['/work/test/math.test.js'] = final['/work/src/math.js'];
    final['/work/node_modules/x/index.js'] = final['/work/src/math.js'];
    const runner = healthy(() => ({ exitCode: 1, files: { ...files, 'coverage/coverage-summary.json': JSON.stringify(summary), 'coverage/coverage-final.json': JSON.stringify(final) } }));
    const result = await runScan(opts(materializeFixture('exec-tests-vitest'), runner));
    expect(param(result, '1.2').raw).toEqual({ kind: 'ratio', numerator: 7, denominator: 11, scale: 100 });
  });

  it('excludes skipped cases from both sides of the pass rate', async () => {
    const files = { ...reportFiles('vitest'), 'results.json': JSON.stringify({ testResults: [{ status: 'passed', assertionResults: [...Array.from({ length: 39 }, () => ({ status: 'passed' })), { status: 'failed' }, ...Array.from({ length: 5 }, () => ({ status: 'skipped' }))] }] }) };
    const result = await runScan(opts(materializeFixture('exec-tests-vitest'), healthy(() => ({ exitCode: 1, files }))));
    expect(param(result, '1.1').raw).toEqual({ kind: 'ratio', numerator: 39, denominator: 40, scale: 100 });
    expect(param(result, '1.1').score).toBeCloseTo(75, 6);
  });
});

describe('6.3 feedback loop time', () => {
  /** Each step takes its own number of milliseconds. */
  function timed() {
    const base = healthy();
    const durations: Record<string, number> = { typecheck: 10_000, lint: 20_000, test: 90_000 };
    return {
      specs: base.specs,
      async runStep(spec: StepSpec) {
        const outcome = await base.runStep(spec);
        return { ...outcome, durationMs: durations[spec.step] ?? 5 };
      },
    };
  }

  it('records the three durations and their sum in run.json and scores the sum', async () => {
    const result = await runScan(opts(materializeFixture('exec-tests-vitest'), timed()));
    expect(result.execution).toEqual({ feedbackLoop: { typecheckSeconds: 10, lintSeconds: 20, testSeconds: 90, totalSeconds: 120 } });
    expect(param(result, '6.3').units?.[0]?.raw).toEqual({ kind: 'number', value: 120 });
    // 60 s scores 100 and 180 s scores 75, so 120 s is 87.5.
    expect(param(result, '6.3').score).toBeCloseTo(87.5, 6);
  });

  it('sums every invocation of a repository with several test runs', async () => {
    const files = {
      'package.json': '{"scripts":{"test":"vitest run"}}\n',
      'src/a.js': 'export function a() {\n  return 1;\n}\n',
      'api/pyproject.toml': '[project]\nname = "api"\n',
      'api/main.py': 'def main():\n    return 1\n',
      'api/tests/test_main.py': 'def test_main():\n    assert True\n',
    };
    const runner = healthy((_spec, kind) => ({ exitCode: 1, files: reportFiles(kind) }));
    const result = await runScan(opts(materializeFixture('blank', {}, files), runner));
    expect(runner.specs.filter((s) => s.step === 'test')).toHaveLength(2);
    expect(result.execution?.feedbackLoop.totalSeconds).toBeCloseTo(0.006, 6);
    expect(param(result, '6.3').units?.map((u) => u.group).sort()).toEqual(['python', 'typescript_javascript']);
  });

  it('writes the durations of the steps that ran even when 6.3 failed', async () => {
    const result = await runScan(opts(materializeFixture('exec-tests-vitest'), healthy(() => ({ exitCode: 0, timeout: true }))));
    expect(param(result, '6.3').status).toBe('failed');
    expect(result.execution?.feedbackLoop.testSeconds).toBeCloseTo(0.001, 6);
  });

  it('is not written in preview', async () => {
    const result = await runScan({ repoPath: materializeFixture('exec-tests-vitest'), methodologyVersion: '1.0', mode: 'preview', asOf: '2026-10-04', tools: fakeToolKit(), measurers: testMeasurers });
    expect(result.execution).toBeUndefined();
  });
});

/** Static tools that find nothing, so a full run on a JavaScript fixture measures every static parameter. */
function allStaticFakes() {
  const osv: FakeTool = (args) => {
    writeFileSync(args[args.indexOf('--output-file') + 1] as string, '{"results":[]}');
    return ok();
  };
  const gitleaks: FakeTool = (args) => {
    writeFileSync(args[args.indexOf('--report-path') + 1] as string, '[]');
    return ok();
  };
  const fetchNothing = (async () => new Response('', { status: 404 })) as typeof fetch;
  return fakeToolKit({ 'osv-scanner': osv, gitleaks }, { fetch: fetchNothing, versions: { 'osv-scanner': '2.0.2', gitleaks: '8.28.0' } });
}

describe('a full run on a fixture', () => {
  it('registers every parameter of the methodology', () => {
    const ids = methodology.dimensions.flatMap((d) => d.parameters.map((p) => p.id)).sort();
    expect(ids).toHaveLength(30);
    expect(measurers.map((m) => m.id).sort()).toEqual(ids);
  });

  it('measures all 30 parameters and is comparable, and diff accepts two such runs', async () => {
    const dir = materializeFixture('exec-tests-vitest');
    const scan = () => runScan(opts(dir, healthy(), { measurers: undefined, tools: allStaticFakes() }));
    const [a, b] = [await scan(), await scan()];
    expect(a.comparable).toBe(true);
    expect(a.parameters.filter((p) => p.status === 'not_measured')).toEqual([]);
    expect(a.parameters).toHaveLength(30);
    expect(a.execution?.feedbackLoop.totalSeconds).toBeGreaterThanOrEqual(0);

    const out = path.join(dir, '..', `health-diff-${path.basename(dir)}`);
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'a.json'), JSON.stringify(a));
    writeFileSync(path.join(out, 'b.json'), JSON.stringify(b));
    let stdout = '';
    const code = await run(['diff', path.join(out, 'a.json'), path.join(out, 'b.json'), '--json'], { stdout: (t) => (stdout += t), stderr: () => undefined, cwd: out });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ compared: true });
  });
});
