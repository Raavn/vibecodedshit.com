import { failure as checkFailure } from '../exec/findings.js';
import { testFailure, totalCases } from '../exec/tests.js';
import type { ExecutionResults, StepOutcome } from '../exec/types.js';
import type { FeedbackLoop } from '../run/schema.js';
import { emptyTallies } from './units.js';
import type { Measurer, UnitRaw } from './types.js';

const seconds = (outcomes: StepOutcome[]): number => outcomes.reduce((sum, outcome) => sum + outcome.durationMs, 0) / 1000;

/** The three step durations in seconds, full precision, and their sum. Steps that did not run count 0. The coverage provider install is not one of the three. */
export function feedbackLoop(exec: ExecutionResults): FeedbackLoop {
  const typecheckSeconds = seconds(exec.typecheck.map((r) => r.outcome));
  const lintSeconds = seconds(exec.lint.map((r) => r.outcome));
  const testSeconds = seconds(exec.test.invocations.map((r) => r.outcome));
  return { typecheckSeconds, lintSeconds, testSeconds, totalSeconds: typecheckSeconds + lintSeconds + testSeconds };
}

/**
 * Summed wall-clock seconds of every typecheck, lint and test step. Every (package, group) unit carries the
 * same sum, weighted by logic lines, so the pooled score is the repository's. Failed unless install, typecheck,
 * lint and the test run all worked (`requires` in the YAML).
 */
export const p63: Measurer = {
  id: '6.3',
  layer: 'execution',
  async measure(ctx) {
    const exec = ctx.exec;
    if (!exec) return { status: 'not_measured', reason: 'execution layer did not run' };
    const stopped = testFailure(exec) ?? [...exec.typecheck, ...exec.lint].map(checkFailure).find((reason) => reason !== null) ?? null;
    if (stopped !== null) return { status: 'failed', reason: stopped };
    if (exec.test.invocations.length === 0) return { status: 'failed', reason: 'no supported test runner was found' };
    if (totalCases(exec) === 0) return { status: 'failed', reason: 'the test runner ran no test case' };
    const value = feedbackLoop(exec).totalSeconds;
    const logic = ctx.scope.files.filter((f) => f.role === 'logic');
    const units: UnitRaw[] = [...emptyTallies(logic).values()]
      .sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group))
      .map((t) => ({ package: t.package, group: t.group, weight: t.weight, raw: { kind: 'number' as const, value } }));
    return { status: 'measured', units };
  },
};
