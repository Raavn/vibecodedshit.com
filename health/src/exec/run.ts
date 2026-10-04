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
import { planExecution } from './plan.js';
import { build } from './steps/build.js';
import { install } from './steps/install.js';
import { lint } from './steps/lint.js';
import { typecheck } from './steps/typecheck.js';
import type { CheckResult, CommandContext, ExecRunner, ExecutionResults, RootResult, Step, StepCommand, StepOutcome } from './types.js';

export interface ExecutionOptions {
  repoPath: string;
  methodology: Methodology;
  scope: Scope;
  runner: ExecRunner;
  /** `{ tag, digest }` of the image the runner uses, recorded in run.json. */
  image: { tag: string; digest: string };
}

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
 * Install, then build per install root, then (when every install worked) typecheck per workspace
 * package and lint per install root. One `docker run` each, run one after another on a temp copy
 * of the tracked files; reports go to a separate temp directory. Both are deleted afterwards.
 * Throws `ToolError` from the runner; a repository failure is only recorded in the results.
 */
export async function runExecution(opts: ExecutionOptions): Promise<ExecutionResults> {
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
        timeoutSeconds: timeouts[step.name],
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
    if (checksRan) {
      const collect = async (step: Step, ctx: CommandContext, into: CheckResult[], envDir: string): Promise<void> => {
        const result = await run(step, ctx, envDir);
        if (result === null || !result.command.tool || !result.command.report) return;
        const report = await readFile(path.join(result.outcome.outputDir, result.command.report), 'utf8').catch(() => null);
        into.push({ tool: result.command.tool, dir: ctx.dir, group: ctx.group, outcome: result.outcome, report });
      };
      for (const pkg of plan.typecheck) await collect(typecheck, context(pkg.dir, pkg.group, pkg.sourceFiles), typecheckResults, pkg.root);
      for (const root of plan.roots) await collect(lint, context(root.dir, root.group, root.sourceFiles), lintResults, root.dir);
    }

    return { image, roots, checksRan, typecheck: typecheckResults, lint: lintResults };
  } finally {
    await work.cleanup();
    await rm(out, { recursive: true, force: true });
  }
}
