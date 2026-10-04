import type { CaseCounts, FileCoverage, TestInvocation, TestRunnerName } from '../types.js';

/** What a runner needs to run and to be read back. File names are relative to the step's /out. */
export interface RunnerSpec {
  results: string;
  coverage: string;
  /** `logicGlobs` are relative to the invocation directory; `pythonTargets` are `--cov` targets for pytest. */
  argv(invocation: TestInvocation, logicGlobs: string[], pythonTargets: string[]): string[];
  parseResults(text: string): CaseCounts | null;
  parseCoverage(text: string, dir: string): Map<string, FileCoverage> | null;
}

export type RunnerSpecs = Record<TestRunnerName, RunnerSpec>;
