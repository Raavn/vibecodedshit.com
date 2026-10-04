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

export interface PythonImport {
  module: string;
  level: number;
  names: string[];
}

export type PythonDeadCodeInfo =
  | { ok: false }
  | { ok: true; symbols: PythonSymbol[]; allNames: string[] | null; imports: PythonImport[] };

const helperPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'python',
  'dead_code_helper.py',
);

/** Symbols, `__all__` and imports of every file, with one helper process. */
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
