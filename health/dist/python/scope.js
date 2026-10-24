import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../scope/types.js';
const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'scope_helper.py');
export function pythonVersion() {
    const result = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
        throw new ToolError('python3 is not available on PATH, but the repository has Python files');
    }
    return `${result.stdout}${result.stderr}`.trim().replace(/^Python\s+/, '');
}
/** Classify all Python files with one helper process. */
export function analyzePythonFiles(repoPath, files) {
    if (files.length === 0)
        return {};
    const result = spawnSync('python3', [helperPath], {
        cwd: repoPath,
        input: JSON.stringify({ files }),
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error) {
        throw new ToolError(`Could not run python3: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new ToolError(`scope_helper.py failed: ${result.stderr.trim() || `exit ${result.status}`}`);
    }
    try {
        return JSON.parse(result.stdout);
    }
    catch {
        throw new ToolError('scope_helper.py printed invalid JSON');
    }
}
