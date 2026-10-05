import path from 'node:path';
import { trackedPaths } from '../scope/tracked.js';
import { runPythonHelper } from './helper.js';
const cache = new Map();
export function resetNoxCache() {
    cache.clear();
}
/** The sessions of the tracked `noxfile.py` in `file`'s directory (one helper spawn per scan, memoized per repository). Undefined when it does not parse. */
export function noxSessions(repoPath, file) {
    const key = path.resolve(repoPath);
    let all = cache.get(key);
    if (!all) {
        const files = trackedPaths(repoPath).filter((f) => path.posix.basename(f) === 'noxfile.py');
        all = files.length === 0 ? {} : runPythonHelper('nox_helper.py', repoPath, { files });
        cache.set(key, all);
    }
    const found = all[file];
    return found?.ok ? found.sessions : undefined;
}
