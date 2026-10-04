import path from 'node:path';
import { runPythonHelper } from './helper.js';

export type PyEnvReads = { ok: false } | { ok: true; names: string[] };

const cache = new Map<string, Record<string, PyEnvReads>>();

export function resetPyEnvCache(): void {
  cache.clear();
}

/** Environment variable names read by each given Python file: one helper spawn per scan, memoized per repository. */
export function pythonEnvReads(repoPath: string, files: string[]): Record<string, PyEnvReads> {
  const key = path.resolve(repoPath);
  const cached = cache.get(key);
  if (cached) return cached;
  const reads = files.length === 0 ? {} : runPythonHelper<Record<string, PyEnvReads>>('env_helper.py', repoPath, { files });
  cache.set(key, reads);
  return reads;
}
