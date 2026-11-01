import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../scope/types.js';

interface PythonParam {
  name: string;
  typed: boolean;
  kind: 'positional' | 'vararg' | 'keyword' | 'kwarg';
}

export interface PythonFunction {
  name: string;
  params: PythonParam[];
  returns: boolean;
  decorators: string[];
}

export type PythonDef =
  | { kind: 'function'; name: string; info: PythonFunction }
  | { kind: 'class'; name: string; methods: PythonFunction[] };

interface PythonTypingPoints {
  anyCount: number;
  castCount: number;
  typeIgnoreLine: number;
  typeIgnoreHeader: number;
  pyrightIgnore: number;
  mypyIgnoreErrors: boolean;
}

export type PythonTypingInfo =
  | { ok: false }
  | { ok: true; points: PythonTypingPoints; allNames: string[] | null; defs: PythonDef[] };

const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'typing_helper.py');

/** Typing facts of every file, with one helper process. */
export function analyzePythonTyping(repoPath: string, files: string[]): Record<string, PythonTypingInfo> {
  if (files.length === 0) return {};
  const result = spawnSync('python3', [helperPath], {
    cwd: repoPath,
    input: JSON.stringify({ files }),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new ToolError(`Could not run python3: ${result.error.message}`);
  if (result.status !== 0) {
    throw new ToolError(`typing_helper.py failed: ${result.stderr.trim() || `exit ${String(result.status)}`}`);
  }
  try {
    return JSON.parse(result.stdout) as Record<string, PythonTypingInfo>;
  } catch {
    throw new ToolError('typing_helper.py printed invalid JSON');
  }
}
