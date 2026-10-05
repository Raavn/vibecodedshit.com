import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../scope/types.js';
const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'imports_helper.py');
function runHelper(repoPath, files) {
    return new Promise((resolve, reject) => {
        const child = spawn('python3', [helperPath], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => reject(new ToolError(`Could not run python3: ${err.message}`)));
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new ToolError(`imports_helper.py failed: ${stderr.trim() || `exit ${String(code)}`}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout).files);
            }
            catch {
                reject(new ToolError('imports_helper.py printed invalid JSON'));
            }
        });
        child.stdin.on('error', () => undefined);
        child.stdin.end(JSON.stringify({ root: path.resolve(repoPath), files }));
    });
}
/** Import statements and builtin `open` calls of every in-scope Python file, one helper process per scan. */
export function readPythonImports(ctx) {
    return ctx.tools.memo(`d3-py-imports:${ctx.repoPath}`, () => {
        const files = ctx.scope.files.filter((f) => f.group === 'python').map((f) => f.path);
        return files.length === 0 ? Promise.resolve({}) : runHelper(ctx.repoPath, files);
    });
}
