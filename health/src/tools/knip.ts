import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Measurement, MeasureContext } from '../measure/types.js';
import { failureReason, unavailable } from './outcome.js';

interface KnipFileIssues {
  /** Unused exports plus unused exported types. */
  exports: number;
  /** Knip lists the whole file as unused. */
  unusedFile: boolean;
  dependencies: string[];
  devDependencies: string[];
  unlisted: string[];
}

export interface KnipOutcome {
  /** Repo-relative posix path to issues. */
  files: Map<string, KnipFileIssues>;
  /** For the run.json warnings of 4.4 and 5.5. */
  warnings: string[];
}

interface RawEntry {
  name?: unknown;
}

interface RawIssue {
  file?: unknown;
  files?: unknown;
  exports?: unknown;
  types?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  unlisted?: unknown;
}

function entries(value: unknown): RawEntry[] {
  return Array.isArray(value) ? (value as RawEntry[]) : [];
}

function names(value: unknown): string[] {
  return entries(value)
    .map((e) => e.name)
    .filter((n): n is string => typeof n === 'string');
}

/**
 * Knip's JSON report. A config knip loads can print to stdout first (dotenv 17 prints an
 * "injected env" banner), so when stdout is not JSON as a whole, the report is read from the last
 * line that starts with `{` to the end.
 */
function parseKnipReport(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    const lines = stdout.split('\n');
    const start = lines.findLastIndex((line) => line.startsWith('{'));
    if (start <= 0) throw err;
    return JSON.parse(lines.slice(start).join('\n'));
  }
}

/** Knip roots: the repository root when it has a tracked package.json, else each shallowest directory holding one. */
export function knipRoots(repoPath: string): string[] {
  const result = spawnSync('git', ['-C', repoPath, 'ls-files', '-z', '--', 'package.json', '**/package.json'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return [];
  const dirs = result.stdout
    .split('\0')
    .filter((p) => p !== '')
    .map((p) => path.posix.dirname(p));
  if (dirs.includes('.')) return ['.'];
  const sorted = [...new Set(dirs)].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const roots: string[] = [];
  for (const dir of sorted) {
    if (!roots.some((root) => dir === root || dir.startsWith(`${root}/`))) roots.push(dir);
  }
  return roots;
}

/** The install root whose dependency install failed in a full run, or undefined. */
function failedInstall(ctx: MeasureContext): string | undefined {
  if (ctx.mode !== 'full' || !ctx.exec || ctx.exec.checksRan) return undefined;
  return ctx.exec.roots.find((root) => root.install !== null && root.install.status !== 'ok')?.dir ?? '.';
}

/** Adds one knip root's report to `outcome`. Returns why the report cannot be used, or null. */
function addReport(outcome: KnipOutcome, root: string, stdout: string): string | null {
  let issues: RawIssue[];
  try {
    const parsed = parseKnipReport(stdout) as { issues?: unknown };
    if (!Array.isArray(parsed.issues)) throw new Error('no issues array');
    issues = parsed.issues as RawIssue[];
  } catch {
    return 'knip printed no parseable JSON report';
  }
  for (const issue of issues) {
    if (typeof issue.file !== 'string') return 'knip report has an unexpected shape';
    const rel = path.posix.normalize(path.posix.join(root === '.' ? '' : root, issue.file.split(path.sep).join('/')));
    const entry = outcome.files.get(rel) ?? {
      exports: 0,
      unusedFile: false,
      dependencies: [],
      devDependencies: [],
      unlisted: [],
    };
    entry.exports += entries(issue.exports).length + entries(issue.types).length;
    entry.unusedFile = entry.unusedFile || entries(issue.files).length > 0;
    entry.dependencies.push(...names(issue.dependencies));
    entry.devDependencies.push(...names(issue.devDependencies));
    entry.unlisted.push(...names(issue.unlisted));
    outcome.files.set(rel, entry);
  }
  return null;
}

/** Knip's exit codes for a finished run: 0 no issues, 1 issues found. */
const KNIP_OK = [0, 1];

/** The knip steps of a full run, which ran in the image on the installed work copy. */
function fromExecution(exec: NonNullable<MeasureContext['exec']>): KnipOutcome | Measurement {
  const outcome: KnipOutcome = { files: new Map(), warnings: [] };
  for (const result of exec.knip) {
    if (result.outcome.status === 'timeout') return unavailable(`knip timed out in ${result.dir}`);
    const code = result.outcome.exitCode;
    if (code === null || !KNIP_OK.includes(code)) return unavailable(`knip exited with ${String(code)} in ${result.dir}`);
    if (result.report === null) return unavailable(`knip wrote no report in ${result.dir}`);
    const failure = addReport(outcome, result.dir, result.report);
    if (failure) return unavailable(`${failure} in ${result.dir}`);
  }
  return outcome;
}

/**
 * One knip run per scan, shared by 4.4 and 5.5. The repository's own knip config is not used
 * (an empty --config), framework plugins stay enabled. A full run whose installs all worked reads
 * the knip steps the execution layer ran in the image, on the installed work copy, so plugins can
 * load configs such as vitest.config.ts and native dependencies match the platform they were
 * installed for. Otherwise knip runs through the tool kit: on the host in the repository for a preview, in the image
 * on the execution work copy for a full run whose install failed.
 */
export function runKnip(ctx: MeasureContext): Promise<KnipOutcome | Measurement> {
  return ctx.tools.memo('knip', async () => {
    if (ctx.mode === 'full' && ctx.exec?.checksRan === true) return fromExecution(ctx.exec);
    const tool = await ctx.tools.resolve('knip');
    if (!tool) return unavailable(ctx.tools.notFoundReason('knip'));
    const failed = failedInstall(ctx);
    const hint = failed === undefined ? '' : ` (dependency install failed in ${failed}, likely cause)`;
    // A full run's tools run in the image, so they read the execution work copy, whose dependencies (if any) were
    // installed there; the repository's own node_modules belong to the host platform.
    const base = ctx.mode === 'full' && ctx.exec ? ctx.exec.workDir : ctx.repoPath;
    const outcome: KnipOutcome = { files: new Map(), warnings: [] };
    const configDir = await mkdtemp(path.join(tmpdir(), 'health-knip-'));
    try {
      const configFile = path.join(configDir, 'knip.json');
      await writeFile(configFile, '{}');
      for (const root of knipRoots(ctx.repoPath)) {
        const result = await ctx.tools.run(
          tool,
          ['--reporter', 'json', '--no-progress', '--no-config-hints', '--config', configFile],
          { cwd: path.join(base, root), env: { DOTENV_CONFIG_QUIET: 'true' } },
        );
        const failure = failureReason(tool, result, KNIP_OK) ?? addReport(outcome, root, result.stdout);
        if (failure) return unavailable(`${failure}${hint}`);
      }
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
    if (failed !== undefined) {
      outcome.warnings.push(`knip ran without installed dependencies because the dependency install failed in ${failed}; unused dependencies may be overcounted`);
    }
    return outcome;
  });
}

export function isOutcome(value: KnipOutcome | Measurement): value is KnipOutcome {
  return 'files' in value && value.files instanceof Map;
}
