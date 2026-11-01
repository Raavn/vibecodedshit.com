import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../scope/types.js';

export interface PythonSymbol {
  name: string;
  qualname: string;
  kind: 'function' | 'class' | 'method';
  line: number;
  startLine: number;
  decorated: boolean;
}

interface PythonImport {
  module: string;
  level: number;
  names: string[];
}

/** A class base: `file` and `class` are set when it resolves to a class defined in a scanned file. */
export interface PythonBase {
  name: string;
  file: string | null;
  class: string | null;
}

export type PythonDeadCodeInfo =
  | { ok: false }
  | {
      ok: true;
      symbols: PythonSymbol[];
      allNames: string[] | null;
      imports: PythonImport[];
      /** Bases of every module-level class (`object` and `Generic[...]` left out). */
      classes: Record<string, { bases: PythonBase[] }>;
    };

const helperPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'python',
  'dead_code_helper.py',
);

/** Symbols, `__all__`, imports and class bases of every file, with one helper process. */
export function analyzePythonDeadCode(repoPath: string, files: string[]): Record<string, PythonDeadCodeInfo> {
  if (files.length === 0) return {};
  const result = spawnSync('python3', [helperPath], {
    cwd: repoPath,
    input: JSON.stringify({ files }),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new ToolError(`Could not run python3: ${result.error.message}`);
  if (result.status !== 0) {
    throw new ToolError(`dead_code_helper.py failed: ${result.stderr.trim() || `exit ${String(result.status)}`}`);
  }
  try {
    return JSON.parse(result.stdout) as Record<string, PythonDeadCodeInfo>;
  } catch {
    throw new ToolError('dead_code_helper.py printed invalid JSON');
  }
}
