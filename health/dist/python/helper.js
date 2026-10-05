import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../scope/types.js';
const pythonDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python');
/** Run one stdlib-only helper from `python/` with JSON in and JSON out. A missing interpreter or a crashed helper is a ToolError. */
export function runPythonHelper(helper, repoPath, input) {
    const result = spawnSync('python3', [path.join(pythonDir, helper)], {
        cwd: repoPath,
        input: JSON.stringify(input),
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error)
        throw new ToolError(`Could not run python3: ${result.error.message}`);
    if (result.status !== 0)
        throw new ToolError(`${helper} failed: ${result.stderr.trim() || `exit ${String(result.status)}`}`);
    try {
        return JSON.parse(result.stdout);
    }
    catch {
        throw new ToolError(`${helper} printed invalid JSON`);
    }
}
