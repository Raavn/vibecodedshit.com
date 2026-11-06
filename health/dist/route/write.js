import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTE_FILE, SLICE_FILE } from './files.js';
/** Deletes the earlier ROUTE.md and Slice files in `dir` (nothing else), then writes the new ones. */
export function writeRouteFiles(dir, files) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
        if (name === ROUTE_FILE || SLICE_FILE.test(name))
            rmSync(path.join(dir, name), { force: true });
    }
    for (const file of files)
        writeFileSync(path.join(dir, file.name), file.content, 'utf8');
}
