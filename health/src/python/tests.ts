import path from 'node:path';
import { trackedPaths } from '../scope/tracked.js';
import { runPythonHelper } from './helper.js';

interface PyImport {
  module: string | null;
  level: number;
  names: { name: string; asname: string | null }[];
  star: boolean;
}

interface PyReexport {
  name: string;
  module: string | null;
  level: number;
  orig: string;
}

interface PyTestCase {
  name: string;
  line: number;
  asserts: boolean;
}

export type PyTestFacts =
  | { ok: false }
  | { ok: true; imports: PyImport[]; defined: string[]; reexports: PyReexport[]; cases: PyTestCase[] };

const cache = new Map<string, Record<string, PyTestFacts>>();

const NOT_FIRST_PARTY = /(?:^|\/)(?:node_modules|\.venv|venv|site-packages|__pycache__)\//;

/**
 * Import and test-case facts of every tracked Python file, packages that only re-export included (they are not scoped files but
 * 1.4 follows imports through them). One helper spawn per scan, memoized per repository.
 */
export function pythonTestFacts(repoPath: string): Record<string, PyTestFacts> {
  const key = path.resolve(repoPath);
  const cached = cache.get(key);
  if (cached) return cached;
  const files = trackedPaths(repoPath).filter((f) => f.endsWith('.py') && !NOT_FIRST_PARTY.test(f));
  const facts = files.length === 0 ? {} : runPythonHelper<Record<string, PyTestFacts>>('tests_helper.py', repoPath, { files });
  cache.set(key, facts);
  return facts;
}
