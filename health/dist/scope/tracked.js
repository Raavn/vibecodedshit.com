import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
const MAX_BYTES = 2 * 1024 * 1024;
const cache = new Map();
/** `git ls-files -z`, posix, before the fixed exclusions and `.healthignore`. Memoized per repository. */
export function trackedPaths(repoPath) {
    const key = path.resolve(repoPath);
    const cached = cache.get(key);
    if (cached)
        return cached;
    const result = spawnSync('git', ['-C', key, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const paths = result.error || result.status !== 0 ? [] : result.stdout.split('\0').filter((entry) => entry !== '');
    cache.set(key, paths);
    return paths;
}
export function resetTrackedCache() {
    cache.clear();
}
/** UTF-8 text from the working tree; null when the path is not tracked, is missing or is over 2 MB. */
export function readTracked(repoPath, rel) {
    const normalized = path.posix.normalize(rel.split(path.sep).join('/'));
    if (!trackedPaths(repoPath).includes(normalized))
        return null;
    const file = path.join(path.resolve(repoPath), normalized);
    try {
        if (statSync(file).size > MAX_BYTES)
            return null;
        return readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
}
