import { spawnSync } from 'node:child_process';

export interface Hotspot {
  path: string;
  /** Commits touching the file in the 12-month window. */
  churn: number;
  /** Sum of the cognitive complexity of every function in the file (from 4.1). */
  complexity: number;
  score: number;
}

export const HOTSPOT_LIMIT = 20;
export const SHALLOW_WARNING = 'history is shallow; churn is a lower bound';

/** What 4.1 stores per file in `reportOnly.complexityByFile`. */
export interface FileComplexitySum {
  file: string;
  complexitySum: number;
}

/** `[asOf minus 12 months, end of asOf day]`, UTC, as ISO strings git accepts. */
export function churnWindow(asOf: string): { since: string; until: string } {
  const start = new Date(`${asOf}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return { since: `${start.toISOString().slice(0, 10)}T00:00:00+00:00`, until: `${asOf}T23:59:59+00:00` };
}

function git(repoPath: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: result.error ? null : result.status, stdout: result.stdout };
}

/** Commits per path in the window, merges and renames ignored. */
export function churnByPath(repoPath: string, asOf: string): Map<string, number> | null {
  const { since, until } = churnWindow(asOf);
  const log = git(repoPath, ['log', `--since=${since}`, `--until=${until}`, '--no-merges', '--no-renames', '--name-only', '-z', '--format=']);
  if (log.status !== 0) return null;
  const churn = new Map<string, number>();
  for (const name of log.stdout.split('\0')) {
    if (name === '') continue;
    churn.set(name, (churn.get(name) ?? 0) + 1);
  }
  return churn;
}

/**
 * Files ranked by churn times complexity. Files with no churn or no complexity are left out.
 * Only the files in `complexity` (logic files in scope that exist at HEAD) can appear.
 */
export function computeHotspots(repoPath: string, asOf: string, complexity: FileComplexitySum[]): { hotspots: Hotspot[]; warnings: string[] } {
  const warnings: string[] = [];
  const churn = churnByPath(repoPath, asOf);
  if (churn === null) return { hotspots: [], warnings: ['hotspots: git history could not be read'] };
  if (git(repoPath, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true') warnings.push(SHALLOW_WARNING);
  const hotspots: Hotspot[] = [];
  for (const entry of complexity) {
    const commits = churn.get(entry.file) ?? 0;
    if (commits === 0 || entry.complexitySum === 0) continue;
    hotspots.push({ path: entry.file, churn: commits, complexity: entry.complexitySum, score: commits * entry.complexitySum });
  }
  hotspots.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { hotspots: hotspots.slice(0, HOTSPOT_LIMIT), warnings };
}
