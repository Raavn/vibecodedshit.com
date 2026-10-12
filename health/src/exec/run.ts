import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnvExample } from '../measure/ops/env-example.js';
import { dirsUpward } from '../measure/ops/entry-points.js';
import type { Methodology } from '../methodology/load.js';
import type { Scope } from '../scope/types.js';
import { readTracked, trackedPaths } from '../scope/tracked.js';
import { createWorkCopy } from '../tools/workcopy.js';
import { ToolError } from '../scope/types.js';
import { planExecution } from './plan.js';
import { build } from './steps/build.js';
import { install } from './steps/install.js';
import { lint } from './steps/lint.js';
import { coverageInstall } from './steps/coverage-install.js';
import { test } from './steps/test.js';
import { typecheck } from './steps/typecheck.js';
import { detectInvocations } from './test-runners/detect.js';
import { RUNNERS } from './test-runners/index.js';
import type { CheckResult, CommandContext, ExecRunner, ExecutionResults, RootResult, Step, StepCommand, StepName, StepOutcome, TestInvocation, TestResult } from './types.js';

export interface ExecutionOptions {
  repoPath: string;
  methodology: Methodology;
  scope: Scope;
  runner: ExecRunner;
  /** `{ tag, digest }` of the image the runner uses, recorded in run.json. */
  image: { tag: string; digest: string };
}

/** `timeouts_seconds` names the test step `tests` and has no entry for the coverage provider install, which is bounded like install. */
const TIMEOUT_KEY: Record<StepName, 'install' | 'build' | 'typecheck' | 'lint' | 'tests'> = {
  install: 'install',
  'coverage-install': 'install',
  build: 'build',
  typecheck: 'typecheck',
  lint: 'lint',
  test: 'tests',
};

function envFor(repoPath: string, dir: string, methodology: Methodology): Record<string, string> {
  for (const up of dirsUpward(dir)) {
    for (const name of methodology.d6.envExampleFiles) {
      const text = readTracked(repoPath, path.posix.join(up, name));
      if (text !== null) return parseEnvExample(text);
    }
  }
  return {};
}

/**
 * Reads the reports of one test run. A timeout or a missing or unreadable results report leaves `results`
 * unset (a repository failure). A results report with at least one case but no usable coverage report is
 * a ToolError: coverage is the tool's job, so the run is invalid.
 */
async function readTest(invocation: TestInvocation, outcome: StepOutcome): Promise<TestResult> {
  const spec = RUNNERS[invocation.runner];
  const base: TestResult = { dir: invocation.dir, group: invocation.group, runner: invocation.runner, args: invocation.args, outcome };
  if (outcome.status === 'timeout') return base;
  const read = (name: string): Promise<string | null> => readFile(path.join(outcome.outputDir, name), 'utf8').catch(() => null);
  const text = await read(spec.results);
  const results = text === null ? null : spec.parseResults(text);
  if (results === null) return base;
  if (results.passed + results.failed + results.errored + results.skipped === 0) return { ...base, results };
  const coverageText = await read(spec.coverage);
  const coverage = coverageText === null ? null : spec.parseCoverage(coverageText, invocation.dir);
  if (coverage === null) throw new ToolError(`${invocation.runner} produced results but no usable coverage data in ${invocation.dir}`);
  if (spec.ranges === undefined || spec.parseRanges === undefined) return { ...base, results, coverage };
  const rangesText = await read(spec.ranges);
  const ranges = rangesText === null ? null : spec.parseRanges(rangesText, invocation.dir);
  if (ranges === null) throw new ToolError(`${invocation.runner} produced no usable coverage-final.json in ${invocation.dir}`);
  return { ...base, results, coverage, ranges };
}

/**
 * Install, then build per install root, then (when every install worked) typecheck per workspace
 * package and lint per install root. One `docker run` each, run one after another on a temp copy
 * of the tracked files; reports go to a separate temp directory, deleted afterwards. The work copy
 * outlives the call so static tools can read the installed dependencies (`results.workDir`); the
 * caller removes it with `cleanup`. On a throw both are deleted here.
 * Throws `ToolError` from the runner; a repository failure is only recorded in the results.
 */
export async function runExecution(opts: ExecutionOptions): Promise<{ results: ExecutionResults; cleanup: () => Promise<void> }> {
  const { repoPath, methodology, scope, runner, image } = opts;
  const timeouts = methodology.execution.timeouts_seconds;
  const tracked = trackedPaths(repoPath);
  const trackedSet = new Set(tracked);
  const plan = planExecution(scope, tracked);

  const work = await createWorkCopy(repoPath, tracked.filter((rel) => existsSync(path.join(repoPath, rel))));
  const out = await mkdtemp(path.join(tmpdir(), 'health-out-'));
  let counter = 0;
  try {
    const run = async (step: Step, ctx: CommandContext, dirForEnv: string): Promise<{ outcome: StepOutcome; command: StepCommand } | null> => {
      const command = step.command(ctx);
      if (command === null) return null;
      counter += 1;
      const label = `${step.name}-${counter}`;
      const outDir = path.join(out, label);
      await mkdir(outDir, { recursive: true });
      const outcome = await runner.runStep({
        label,
        step: step.name,
        network: step.network,
        argv: command.argv,
        cwd: ctx.dir,
        timeoutSeconds: timeouts[TIMEOUT_KEY[step.name]],
        env: envFor(repoPath, dirForEnv, methodology),
        workDir: work.dir,
        outDir,
      });
      return { outcome, command };
    };
    const context = (dir: string, group: CommandContext['group'], files: string[]): CommandContext => ({
      dir,
      group,
      tracked: trackedSet,
      read: (rel) => readTracked(repoPath, rel),
      files,
    });

    const roots: RootResult[] = [];
    for (const root of plan.roots) {
      const ctx = context(root.dir, root.group, root.logicFiles);
      const installed = await run(install, ctx, root.dir);
      const installOk = installed === null || installed.outcome.status === 'ok';
      const built = installOk ? await run(build, ctx, root.dir) : null;
      roots.push({ dir: root.dir, group: root.group, weight: root.weight, install: installed?.outcome ?? null, build: built?.outcome ?? null });
    }

    const checksRan = roots.every((root) => root.install === null || root.install.status === 'ok');
    const typecheckResults: CheckResult[] = [];
    const lintResults: CheckResult[] = [];
    const testResults: TestResult[] = [];
    if (checksRan) {
      const collect = async (step: Step, ctx: CommandContext, into: CheckResult[], envDir: string): Promise<void> => {
        const result = await run(step, ctx, envDir);
        if (result === null || !result.command.tool || !result.command.report) return;
        const report = await readFile(path.join(result.outcome.outputDir, result.command.report), 'utf8').catch(() => null);
        into.push({ tool: result.command.tool, dir: ctx.dir, group: ctx.group, outcome: result.outcome, report });
      };
      for (const pkg of plan.typecheck) await collect(typecheck, context(pkg.dir, pkg.group, pkg.sourceFiles), typecheckResults, pkg.root);
      for (const root of plan.roots) await collect(lint, context(root.dir, root.group, root.sourceFiles), lintResults, root.dir);

      const invocations = detectInvocations({ roots: plan.roots, scope, tracked: trackedSet, read: (rel) => readTracked(repoPath, rel) });
      for (const invocation of invocations) {
        const files = plan.roots
          .filter((r) => r.group === invocation.group)
          .flatMap((r) => r.logicFiles)
          .filter((file) => invocation.dir === '.' || file.startsWith(`${invocation.dir}/`));
        const ctx: CommandContext = { ...context(invocation.dir, invocation.group, files), invocation };
        const provider = await run(coverageInstall, ctx, invocation.dir);
        if (provider && provider.outcome.status !== 'ok') {
          throw new ToolError(`the coverage provider could not be installed for ${invocation.runner} in ${invocation.dir} (${provider.outcome.status})`);
        }
        const ran = await run(test, ctx, invocation.dir);
        if (ran === null) continue;
        testResults.push(await readTest(invocation, ran.outcome));
      }
    }

    return {
      results: { image, roots, checksRan, typecheck: typecheckResults, lint: lintResults, test: { invocations: testResults }, workDir: work.dir },
      cleanup: () => work.cleanup(),
    };
  } catch (err) {
    await work.cleanup();
    throw err;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
