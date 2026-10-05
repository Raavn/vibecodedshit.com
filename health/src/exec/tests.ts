import type { Measurement, MeasureContext, UnitRaw } from '../measure/types.js';
import { emptyTallies, tallyUnits, unitId } from '../measure/units.js';
import type { ExecutionResults, FileCoverage } from './types.js';

type Exec = NonNullable<MeasureContext['exec']>;

/** Why the test run is a repository failure (1.1 to 1.3, 6.3 score 0), or null when every run has a usable results report. */
export function testFailure(exec: Exec): string | null {
  if (!exec.checksRan) return 'install failed, so the step did not run';
  for (const run of exec.test.invocations) {
    if (run.outcome.status === 'timeout') return `${run.runner} timed out in ${run.dir}`;
    if (!run.results) return `${run.runner} wrote no usable results report in ${run.dir}`;
  }
  return null;
}

export function totalCases(exec: ExecutionResults): number {
  return exec.test.invocations.reduce((sum, run) => sum + (run.results ? run.results.passed + run.results.failed + run.results.errored + run.results.skipped : 0), 0);
}

function isUnder(file: string, dir: string): boolean {
  return dir === '.' || file.startsWith(`${dir}/`);
}

/** 1.1: passed / (passed + failed + errored) per test invocation. Skipped cases are in neither. With no case anywhere every unit is 0 of 0. */
export function measurePassRate(ctx: MeasureContext): Measurement {
  const exec = ctx.exec;
  if (!exec) return { status: 'not_measured', reason: 'execution layer did not run' };
  const reason = testFailure(exec);
  if (reason !== null) return { status: 'failed', reason };
  const logic = ctx.scope.files.filter((f) => f.role === 'logic');
  if (exec.test.invocations.length === 0) return { status: 'measured', units: tallyUnits(emptyTallies(logic)) };
  const units: UnitRaw[] = exec.test.invocations.map((run) => {
    const counts = run.results ?? { passed: 0, failed: 0, errored: 0, skipped: 0 };
    return {
      package: run.dir,
      group: run.group,
      weight: logic.filter((f) => f.group === run.group && isUnder(f.path, run.dir)).reduce((sum, f) => sum + f.logicLines, 0),
      raw: { kind: 'ratio' as const, numerator: counts.passed, denominator: counts.passed + counts.failed + counts.errored, scale: 100 },
    };
  });
  return { status: 'measured', units };
}

/**
 * 1.2 (lines) and 1.3 (branches): covered over coverable across the in-scope logic files, per (package,
 * group) unit. A logic file the coverage report lacks counts as 0 covered with its logic lines coverable
 * (it adds no branches), so it cannot raise the ratio. Coverage entries outside the logic set are dropped.
 * With no test case at all every unit is 0 of 0 and scores `when_empty`.
 */
export function measureCoverage(ctx: MeasureContext, kind: 'lines' | 'branches'): Measurement {
  const exec = ctx.exec;
  if (!exec) return { status: 'not_measured', reason: 'execution layer did not run' };
  const reason = testFailure(exec);
  if (reason !== null) return { status: 'failed', reason };
  const logic = ctx.scope.files.filter((f) => f.role === 'logic');
  const tallies = emptyTallies(logic);
  if (totalCases(exec) === 0) return { status: 'measured', units: tallyUnits(tallies) };

  const merged = new Map<string, FileCoverage>();
  for (const run of exec.test.invocations) {
    for (const [file, cov] of run.coverage ?? []) {
      const had = merged.get(file);
      merged.set(file, {
        lines: { total: (had?.lines.total ?? 0) + cov.lines.total, covered: (had?.lines.covered ?? 0) + cov.lines.covered },
        branches: { total: (had?.branches.total ?? 0) + cov.branches.total, covered: (had?.branches.covered ?? 0) + cov.branches.covered },
      });
    }
  }
  let missing = 0;
  for (const file of logic) {
    const tally = tallies.get(unitId(file));
    if (!tally) continue;
    const cov = merged.get(file.path);
    if (cov) {
      tally.numerator += cov[kind].covered;
      tally.denominator += cov[kind].total;
    } else {
      missing += 1;
      if (kind === 'lines') tally.denominator += file.logicLines;
    }
  }
  return {
    status: 'measured',
    units: tallyUnits(tallies),
    ...(kind === 'lines' && missing > 0 ? { warnings: [`${missing} logic file(s) missing from the coverage report were counted as 0% covered`] } : {}),
  };
}
