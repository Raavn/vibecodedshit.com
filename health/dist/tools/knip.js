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
/**
 * Knip's JSON report. A config knip loads can print to stdout first (dotenv 17 prints an
 * "injected env" banner), so when stdout is not JSON as a whole, the report is read from the last
 * line that starts with `{` to the end.
 */
function parseKnipReport(stdout) {
    try {
        return JSON.parse(stdout);
    }
    catch (err) {
        const lines = stdout.split('\n');
        const start = lines.findLastIndex((line) => line.startsWith('{'));
        if (start <= 0)
            throw err;
        return JSON.parse(lines.slice(start).join('\n'));
    }
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
/** The install root whose dependency install failed in a full run, or undefined. */
function failedInstall(ctx) {
    if (ctx.mode !== 'full' || !ctx.exec || ctx.exec.checksRan)
        return undefined;
    return ctx.exec.roots.find((root) => root.install !== null && root.install.status !== 'ok')?.dir ?? '.';
}
/**
 * One knip run per scan, shared by 4.4 and 5.5. The repository's own knip config is not used
 * (an empty --config), framework plugins stay enabled. A full run whose installs all worked runs
 * knip in the execution work copy, so plugins can load configs such as vitest.config.ts and
 * script binaries map to their packages; otherwise knip runs in the repository.
 */
export function runKnip(ctx) {
    return ctx.tools.memo('knip', async () => {
        const tool = await ctx.tools.resolve('knip');
        if (!tool)
            return unavailable(ctx, notFoundReason('knip'));
        const installed = ctx.mode === 'full' && ctx.exec?.checksRan === true ? ctx.exec.workDir : undefined;
        const failed = failedInstall(ctx);
        const hint = failed === undefined ? '' : ` (dependency install failed in ${failed}, likely cause)`;
        const outcome = { files: new Map(), warnings: [] };
        const configDir = await mkdtemp(path.join(tmpdir(), 'health-knip-'));
        try {
            const configFile = path.join(configDir, 'knip.json');
            await writeFile(configFile, '{}');
            for (const root of knipRoots(ctx.repoPath)) {
                const cwd = path.join(installed ?? ctx.repoPath, root);
                const result = await ctx.tools.run(tool, ['--reporter', 'json', '--no-progress', '--no-config-hints', '--config', configFile], { cwd, env: { DOTENV_CONFIG_QUIET: 'true' } });
                const failure = failureReason(tool, result, [0, 1]);
                if (failure)
                    return unavailable(ctx, `${failure}${hint}`);
                let issues;
                try {
                    const parsed = parseKnipReport(result.stdout);
                    if (!Array.isArray(parsed.issues))
                        throw new Error('no issues array');
                    issues = parsed.issues;
                }
                catch {
                    return unavailable(ctx, `knip printed no parseable JSON report${hint}`);
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
        if (failed !== undefined) {
            outcome.warnings.push(`knip ran without installed dependencies because the dependency install failed in ${failed}; unused dependencies may be overcounted`);
        }
        return outcome;
    });
}
export function isOutcome(value) {
    return 'files' in value && value.files instanceof Map;
}
