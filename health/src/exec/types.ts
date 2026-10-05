import type { Group } from '../scope/types.js';

export type StepName = 'install' | 'build' | 'typecheck' | 'lint' | 'coverage-install' | 'test';

/** One container run. `cwd` is relative to the work copy, posix. */
export interface StepSpec {
  /** Unique label, also the container name suffix and the report subdirectory. */
  label: string;
  step: StepName;
  network: boolean;
  argv: string[];
  cwd: string;
  timeoutSeconds: number;
  env: Record<string, string>;
  workDir: string;
  /** Host directory mounted at /out for this step. */
  outDir: string;
}

export interface StepOutcome {
  /** `ok` is exit code 0, `failed` any other exit code, `timeout` a kill after the step timeout. */
  status: 'ok' | 'failed' | 'timeout';
  exitCode: number | null;
  durationMs: number;
  outputDir: string;
}

export interface ExecRunner {
  /** Throws `ToolError` when the container could not run at all (docker, image or command missing). */
  runStep(spec: StepSpec): Promise<StepOutcome>;
}

export interface CommandContext {
  /** Directory of the step, repo-relative posix. */
  dir: string;
  group: Group;
  /** Tracked repo-relative paths. */
  tracked: Set<string>;
  /** Tracked text file contents, null when missing. */
  read(rel: string): string | null;
  /** In-scope (logic and test) files the step covers, repo-relative. */
  files: string[];
  /** Test and coverage-install steps: the invocation they belong to. */
  invocation?: TestInvocation;
}

export type CheckTool = 'tsc' | 'pyright' | 'mypy' | 'eslint' | 'ruff';

export interface StepCommand {
  argv: string[];
  /** Typecheck and lint steps: the tool, whose stdout `health-capture` writes to /out/<report>. */
  tool?: CheckTool;
  report?: string;
}

/** A step is one file under `steps/`: whether the network is on and the command to run. Null means there is nothing to run. */
export interface Step {
  name: StepName;
  network: boolean;
  command(ctx: CommandContext): StepCommand | null;
}

/** Install and build of one install root, with the language group it covers. */
export interface RootResult {
  dir: string;
  group: Group;
  /** Logic lines of the group beneath this root. */
  weight: number;
  /** Null when the root has nothing to install. */
  install: StepOutcome | null;
  /** Null when the root has no build step, or when the install failed. */
  build: StepOutcome | null;
}

/** One typecheck or lint step, with the report it wrote. */
export interface CheckResult {
  tool: CheckTool;
  /** Workspace package the step ran in (typecheck) or the install root (lint). */
  dir: string;
  group: Group;
  outcome: StepOutcome;
  /** Contents of the report file, null when none was written. */
  report: string | null;
}

export type TestRunnerName = 'vitest' | 'jest' | 'mocha' | 'node-test' | 'pytest';

/** One test runner run: the directory it runs in, the runner and the arguments kept from the repository's `test` script. */
export interface TestInvocation {
  dir: string;
  group: Group;
  runner: TestRunnerName;
  args: string[];
}

export interface CaseCounts {
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

export interface FileCoverage {
  lines: { total: number; covered: number };
  branches: { total: number; covered: number };
}

/** One statement or function of an istanbul `coverage-final.json`: its 1-based line span and how often it ran. */
export interface CoverageRange {
  start: number;
  end: number;
  hits: number;
}

export interface TestResult extends TestInvocation {
  outcome: StepOutcome;
  /** Case counts from the results report. Undefined when the run timed out or wrote no usable report. */
  results?: CaseCounts;
  /** Per repo-relative file, from the coverage report. Undefined when the run had no case, so no coverage was required. */
  coverage?: Map<string, FileCoverage>;
  /** Per repo-relative file, the statement and function ranges of a TS/JS runner's coverage-final.json. 1.2 counts lines from these. */
  ranges?: Map<string, CoverageRange[]>;
}

export interface ExecutionResults {
  image: { tag: string; digest: string };
  roots: RootResult[];
  /** False when an install failed, so typecheck and lint did not run. */
  checksRan: boolean;
  typecheck: CheckResult[];
  lint: CheckResult[];
  /** One entry per test runner invocation. Empty when no supported runner was found or the checks did not run. */
  test: { invocations: TestResult[] };
}
