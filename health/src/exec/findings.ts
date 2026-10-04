import type { Measurement, MeasureContext, UnitRaw } from '../measure/types.js';
import { emptyTallies, unitId } from '../measure/units.js';
import { NORMAL_EXIT, parseEslint, parseMypy, parsePyright, parseRuff, parseTsc, type Findings } from './reports.js';
import type { CheckResult } from './types.js';

function parse(result: CheckResult): Findings | null {
  switch (result.tool) {
    case 'tsc':
      return parseTsc(result.report ?? '', result.dir);
    case 'mypy':
      return parseMypy(result.report ?? '', result.dir);
    case 'pyright':
      return parsePyright(result.report ?? '', result.dir);
    case 'eslint':
      return parseEslint(result.report ?? '', result.dir);
    case 'ruff':
      return parseRuff(result.report ?? '', result.dir);
  }
}

/** Why a check counts as a repository failure, or null when it ran and its report can be read. */
function failure(result: CheckResult): string | null {
  if (result.outcome.status === 'timeout') return `${result.tool} timed out in ${result.dir}`;
  const code = result.outcome.exitCode;
  if (code === null || !NORMAL_EXIT[result.tool].includes(code)) return `${result.tool} exited with ${String(code)} in ${result.dir}`;
  if (result.report === null || parse(result) === null) return `${result.tool} wrote no usable report in ${result.dir}`;
  return null;
}

/**
 * Findings per 1,000 source lines for 2.1 and 2.5. Numerator: findings located in in-scope logic and
 * test files (anything elsewhere is dropped). Denominator: source lines of those files, per
 * (package, group) unit. An install that failed, a timeout, or a checker with no usable report
 * is a repository failure: the parameter scores 0.
 */
export function measureFindings(ctx: MeasureContext, results: (exec: NonNullable<MeasureContext['exec']>) => CheckResult[]): Measurement {
  const exec = ctx.exec;
  if (!exec) return { status: 'not_measured', reason: 'execution layer did not run' };
  if (!exec.checksRan) return { status: 'failed', reason: 'install failed, so the step did not run' };
  const checks = results(exec);
  for (const check of checks) {
    const reason = failure(check);
    if (reason !== null) return { status: 'failed', reason };
  }

  const inScope = ctx.scope.files.filter((f) => f.role === 'logic' || f.role === 'test');
  const tallies = emptyTallies(inScope);
  const byPath = new Map(inScope.map((f) => [f.path, f]));
  for (const file of inScope) {
    const tally = tallies.get(unitId(file));
    if (tally) tally.denominator += file.sourceLines;
  }
  for (const check of checks) {
    for (const reported of parse(check)?.files ?? []) {
      const file = byPath.get(reported);
      const tally = file && tallies.get(unitId(file));
      if (tally) tally.numerator += 1;
    }
  }
  const units: UnitRaw[] = [...tallies.values()]
    .sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group))
    .map((t) => ({
      package: t.package,
      group: t.group,
      weight: t.weight,
      raw: { kind: 'ratio' as const, numerator: t.numerator, denominator: t.denominator, scale: 1000 },
    }));
  return { status: 'measured', units };
}
