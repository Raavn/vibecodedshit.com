import type { CaseCounts, CoverageRange, FileCoverage, TestInvocation, TestRunnerName } from '../types.js';

/** What a runner needs to run and to be read back. File names are relative to the step's /out. */
export interface RunnerSpec {
  results: string;
  coverage: string;
  /** TS/JS runners: the istanbul `json` report 1.2 counts lines from. Python (pytest-cov) has none. */
  ranges?: string;
  /** `logicGlobs` are relative to the invocation directory; `pythonTargets` are `--cov` targets for pytest. */
  argv(invocation: TestInvocation, logicGlobs: string[], pythonTargets: string[]): string[];
  parseResults(text: string): CaseCounts | null;
  parseCoverage(text: string, dir: string): Map<string, FileCoverage> | null;
  parseRanges?(text: string, dir: string): Map<string, CoverageRange[]> | null;
}

export type RunnerSpecs = Record<TestRunnerName, RunnerSpec>;
