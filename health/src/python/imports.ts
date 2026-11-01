import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MeasureContext } from '../measure/types.js';
import { ToolError } from '../scope/types.js';

interface PythonImport {
  line: number;
  level: number;
  modules: string[];
  /** Inside a function, async function or lambda body (a class body is not lazy). */
  lazy: boolean;
  /** Inside the body of `if TYPE_CHECKING:` (or `if x.TYPE_CHECKING:`) at any nesting. */
  typeOnly: boolean;
}

export interface PythonImportsInfo {
  syntaxError: boolean;
  imports: PythonImport[];
  opensBuiltin: boolean;
}

const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'imports_helper.py');

function runHelper(repoPath: string, files: string[]): Promise<Record<string, PythonImportsInfo>> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [helperPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(new ToolError(`Could not run python3: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new ToolError(`imports_helper.py failed: ${stderr.trim() || `exit ${String(code)}`}`));
        return;
      }
      try {
        resolve((JSON.parse(stdout) as { files: Record<string, PythonImportsInfo> }).files);
      } catch {
        reject(new ToolError('imports_helper.py printed invalid JSON'));
      }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({ root: path.resolve(repoPath), files }));
  });
}

/** Import statements and builtin `open` calls of every in-scope Python file, one helper process per scan. */
export function readPythonImports(ctx: Pick<MeasureContext, 'tools' | 'repoPath' | 'scope'>): Promise<Record<string, PythonImportsInfo>> {
  return ctx.tools.memo(`d3-py-imports:${ctx.repoPath}`, () => {
    const files = ctx.scope.files.filter((f) => f.group === 'python').map((f) => f.path);
    return files.length === 0 ? Promise.resolve({}) : runHelper(ctx.repoPath, files);
  });
}
