import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * Copy these working-tree files (same relative paths) into a new temp directory.
 * Tools that read their own config run there, so no repository config can change a score.
 * A path missing from the working tree (tracked but deleted, or a broken symlink) is skipped.
 */
export async function createWorkCopy(repoPath, relPaths) {
    const dir = await mkdtemp(path.join(tmpdir(), 'health-work-'));
    try {
        for (const rel of relPaths) {
            const src = path.join(repoPath, rel);
            if (!existsSync(src))
                continue;
            const dest = path.join(dir, rel);
            await mkdir(path.dirname(dest), { recursive: true });
            await copyFile(src, dest);
        }
    }
    catch (err) {
        await rm(dir, { recursive: true, force: true });
        throw err;
    }
    return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
