import path from 'node:path';
import { runPythonHelper } from './helper.js';
const cache = new Map();
/** Environment variable names read by each given Python file: one helper spawn per scan, memoized per repository. */
export function pythonEnvReads(repoPath, files) {
    const key = path.resolve(repoPath);
    const cached = cache.get(key);
    if (cached)
        return cached;
    const reads = files.length === 0 ? {} : runPythonHelper('env_helper.py', repoPath, { files });
    cache.set(key, reads);
    return reads;
}
