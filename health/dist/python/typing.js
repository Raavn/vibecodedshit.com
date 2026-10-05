import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../scope/types.js';
const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'typing_helper.py');
/** Typing facts of every file, with one helper process. */
export function analyzePythonTyping(repoPath, files) {
    if (files.length === 0)
        return {};
    const result = spawnSync('python3', [helperPath], {
        cwd: repoPath,
        input: JSON.stringify({ files }),
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error)
        throw new ToolError(`Could not run python3: ${result.error.message}`);
    if (result.status !== 0) {
        throw new ToolError(`typing_helper.py failed: ${result.stderr.trim() || `exit ${String(result.status)}`}`);
    }
    try {
        return JSON.parse(result.stdout);
    }
    catch {
        throw new ToolError('typing_helper.py printed invalid JSON');
    }
}
