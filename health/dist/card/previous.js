import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { readRun, RunReadError } from '../run/read.js';
/**
 * The newest `<historyDir>/<dir>/run.json` written before `currentFile` for the same repository path, methodology version
 * and mode, valid and with a health score. Runs from other versions are never compared, and a preview next to a full run
 * would compare different parameters. Unreadable files are skipped.
 */
export function findPreviousRun(currentFile, current, historyDir) {
    const before = statSync(currentFile).mtimeMs;
    let best = null;
    for (const entry of readdirSync(historyDir, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const file = path.join(historyDir, entry.name, 'run.json');
        if (!existsSync(file))
            continue;
        // The current run is never older than itself, so this also skips it.
        const mtime = statSync(file).mtimeMs;
        if (mtime >= before || (best && mtime <= best.mtime))
            continue;
        let run;
        try {
            run = readRun(file);
        }
        catch (err) {
            if (err instanceof RunReadError)
                continue;
            throw err;
        }
        if (!run.valid || run.health === null)
            continue;
        if (run.repo.path !== current.repo.path || run.methodology.version !== current.methodology.version || run.mode !== current.mode)
            continue;
        best = { file, health: run.health, mtime };
    }
    return best && { file: best.file, health: best.health };
}
