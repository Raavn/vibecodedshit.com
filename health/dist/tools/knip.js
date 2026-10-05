import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { failureReason, notFoundReason, unavailable } from './outcome.js';
function entries(value) {
    return Array.isArray(value) ? value : [];
}
function names(value) {
    return entries(value)
        .map((e) => e.name)
        .filter((n) => typeof n === 'string');
}
/** Knip roots: the repository root when it has a tracked package.json, else each shallowest directory holding one. */
export function knipRoots(repoPath) {
    const result = spawnSync('git', ['-C', repoPath, 'ls-files', '-z', '--', 'package.json', '**/package.json'], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
        return [];
    const dirs = result.stdout
        .split('\0')
        .filter((p) => p !== '')
        .map((p) => path.posix.dirname(p));
    if (dirs.includes('.'))
        return ['.'];
    const sorted = [...new Set(dirs)].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    const roots = [];
    for (const dir of sorted) {
        if (!roots.some((root) => dir === root || dir.startsWith(`${root}/`)))
            roots.push(dir);
    }
    return roots;
}
/**
 * One knip run per scan, shared by 4.4 and 5.5. The repository's own knip config is not used
 * (an empty --config), framework plugins stay enabled.
 */
export function runKnip(ctx) {
    return ctx.tools.memo('knip', async () => {
        const tool = await ctx.tools.resolve('knip');
        if (!tool)
            return unavailable(ctx, notFoundReason('knip'));
        const outcome = { files: new Map() };
        const configDir = await mkdtemp(path.join(tmpdir(), 'health-knip-'));
        try {
            const configFile = path.join(configDir, 'knip.json');
            await writeFile(configFile, '{}');
            for (const root of knipRoots(ctx.repoPath)) {
                const cwd = path.join(ctx.repoPath, root);
                const result = await ctx.tools.run(tool, ['--reporter', 'json', '--no-progress', '--no-config-hints', '--config', configFile], { cwd });
                const failure = failureReason(tool, result, [0, 1]);
                if (failure)
                    return unavailable(ctx, failure);
                let issues;
                try {
                    const parsed = JSON.parse(result.stdout);
                    if (!Array.isArray(parsed.issues))
                        throw new Error('no issues array');
                    issues = parsed.issues;
                }
                catch {
                    return unavailable(ctx, 'knip printed no parseable JSON report');
                }
                for (const issue of issues) {
                    if (typeof issue.file !== 'string')
                        return unavailable(ctx, 'knip report has an unexpected shape');
                    const rel = path.posix.normalize(path.posix.join(root === '.' ? '' : root, issue.file.split(path.sep).join('/')));
                    const entry = outcome.files.get(rel) ?? {
                        exports: 0,
                        unusedFile: false,
                        dependencies: [],
                        devDependencies: [],
                        unlisted: [],
                    };
                    entry.exports += entries(issue.exports).length + entries(issue.types).length;
                    entry.unusedFile = entry.unusedFile || entries(issue.files).length > 0;
                    entry.dependencies.push(...names(issue.dependencies));
                    entry.devDependencies.push(...names(issue.devDependencies));
                    entry.unlisted.push(...names(issue.unlisted));
                    outcome.files.set(rel, entry);
                }
            }
        }
        finally {
            await rm(configDir, { recursive: true, force: true });
        }
        return outcome;
    });
}
export function isOutcome(value) {
    return 'files' in value && value.files instanceof Map;
}
