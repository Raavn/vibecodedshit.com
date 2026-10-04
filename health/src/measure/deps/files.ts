import { readFileSync } from 'node:fs';
import path from 'node:path';
import { trackedPaths } from '../../scope/tracked.js';

const sets = new Map<string, Set<string>>();

export function trackedSet(repoPath: string): Set<string> {
  const key = path.resolve(repoPath);
  const cached = sets.get(key);
  if (cached) return cached;
  const made = new Set(trackedPaths(key));
  sets.set(key, made);
  return made;
}

export function joinRel(...parts: string[]): string {
  return parts.filter((p) => p !== '' && p !== '.').join('/');
}

/** Text of a tracked file of any size, or null when it is not tracked or unreadable. */
export function readTrackedText(repoPath: string, rel: string): string | null {
  if (!trackedSet(repoPath).has(rel)) return null;
  try {
    return readFileSync(path.join(path.resolve(repoPath), rel), 'utf8');
  } catch {
    return null;
  }
}

/** Tracked files that sit directly in `dir` ('' for the repository root). */
export function trackedIn(repoPath: string, dir: string): string[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  const found: string[] = [];
  for (const file of trackedSet(repoPath)) {
    if (!file.startsWith(prefix)) continue;
    if (file.slice(prefix.length).includes('/')) continue;
    found.push(file);
  }
  return found.sort();
}
