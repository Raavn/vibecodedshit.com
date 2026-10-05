import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * Copy these working-tree files (same relative paths) into a new temp directory.
 * Tools that read their own config run there, so no repository config can change a score.
 */
export async function createWorkCopy(repoPath, relPaths) {
    const dir = await mkdtemp(path.join(tmpdir(), 'health-work-'));
    try {
        for (const rel of relPaths) {
            const dest = path.join(dir, rel);
            await mkdir(path.dirname(dest), { recursive: true });
            await copyFile(path.join(repoPath, rel), dest);
        }
    }
    catch (err) {
        await rm(dir, { recursive: true, force: true });
        throw err;
    }
    return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
