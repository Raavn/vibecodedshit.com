import path from 'node:path';
import { trackedPaths } from '../scope/tracked.js';
import { runPythonHelper } from './helper.js';
const cache = new Map();
const NOT_FIRST_PARTY = /(?:^|\/)(?:node_modules|\.venv|venv|site-packages|__pycache__)\//;
/**
 * Import and test-case facts of every tracked Python file, packages that only re-export included (they are not scoped files but
 * 1.4 follows imports through them). One helper spawn per scan, memoized per repository.
 */
export function pythonTestFacts(repoPath) {
    const key = path.resolve(repoPath);
    const cached = cache.get(key);
    if (cached)
        return cached;
    const files = trackedPaths(repoPath).filter((f) => f.endsWith('.py') && !NOT_FIRST_PARTY.test(f));
    const facts = files.length === 0 ? {} : runPythonHelper('tests_helper.py', repoPath, { files });
    cache.set(key, facts);
    return facts;
}
