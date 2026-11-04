import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isUnder } from '../exec/plan.js';
import { failedRootOf } from '../exec/roots.js';
import { failureReason, unavailable } from './outcome.js';
/** Whether the package at `pkg` lies under a knip root where knip failed. */
export function knipFailed(knip, pkg) {
    return knip.failedRoots.some((root) => isUnder(pkg, root));
}
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
/** Adds one knip root's report to `outcome`. Returns why the report cannot be used, or null. */
function addReport(outcome, root, stdout) {
    let issues;
    try {
        const parsed = parseKnipReport(stdout);
        if (!Array.isArray(parsed.issues))
            throw new Error('no issues array');
        issues = parsed.issues;
    }
    catch {
        return 'knip printed no parseable JSON report';
    }
    for (const issue of issues) {
        if (typeof issue.file !== 'string')
            return 'knip report has an unexpected shape';
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
    return null;
}
/** Knip's exit codes for a finished run: 0 no issues, 1 issues found. */
const KNIP_OK = [0, 1];
/** Adds the knip steps of a full run, which ran in the image on the installed work copy, to `outcome`. Returns why one cannot be used, or null. */
function fromExecution(exec, outcome) {
    for (const result of exec.knip) {
        if (result.outcome.status === 'timeout')
            return unavailable(`knip timed out in ${result.dir}`);
        const code = result.outcome.exitCode;
        if (code === null || !KNIP_OK.includes(code))
            return unavailable(`knip exited with ${String(code)} in ${result.dir}`);
        if (result.report === null)
            return unavailable(`knip wrote no report in ${result.dir}`);
        const failure = addReport(outcome, result.dir, result.report);
        if (failure)
            return unavailable(`${failure} in ${result.dir}`);
    }
    return null;
}
/**
 * One knip run per scan, shared by 4.4 and 5.5. The repository's own knip config is not used
 * (an empty --config), framework plugins stay enabled. A full run reads the knip steps the execution layer ran
 * in the image, on the installed work copy, for every knip root whose install worked, so plugins can
 * load configs such as vitest.config.ts and native dependencies match the platform they were
 * installed for. A knip root whose install failed is still tried through the tool kit, in the image on the
 * execution work copy: a report is used with a warning that unused dependencies may be overcounted, and a
 * crash, timeout or unusable report marks the root failed (`failedRoots`). A knip step failing in a root whose
 * install worked, or knip not starting at all, is not_measured. A preview runs knip through the tool kit on
 * the host, in the repository.
 */
export function runKnip(ctx) {
    return ctx.tools.memo('knip', async () => {
        const exec = ctx.mode === 'full' ? ctx.exec : undefined;
        const outcome = { files: new Map(), warnings: [], failedRoots: [] };
        const roots = knipRoots(ctx.repoPath);
        let viaTools = roots;
        if (exec) {
            const stopped = fromExecution(exec, outcome);
            if (stopped)
                return stopped;
            viaTools = roots.filter((root) => failedRootOf(exec, root, 'typescript_javascript') !== undefined);
            if (viaTools.length === 0)
                return outcome;
        }
        const tool = await ctx.tools.resolve('knip');
        if (!tool)
            return unavailable(ctx.tools.notFoundReason('knip'));
        // A full run's tools run in the image, so they read the execution work copy, whose dependencies (if any) were
        // installed there; the repository's own node_modules belong to the host platform.
        const base = exec ? exec.workDir : ctx.repoPath;
        const configDir = await mkdtemp(path.join(tmpdir(), 'health-knip-'));
        try {
            const configFile = path.join(configDir, 'knip.json');
            await writeFile(configFile, '{}');
            for (const root of viaTools) {
                const result = await ctx.tools.run(tool, ['--reporter', 'json', '--no-progress', '--no-config-hints', '--config', configFile], { cwd: path.join(base, root), env: { DOTENV_CONFIG_QUIET: 'true' } });
                const failure = failureReason(tool, result, KNIP_OK) ?? addReport(outcome, root, result.stdout);
                const installRoot = exec ? failedRootOf(exec, root, 'typescript_javascript') : undefined;
                if (failure === null) {
                    if (installRoot) {
                        outcome.warnings.push(`knip ran without installed dependencies because the dependency install failed in ${installRoot.dir}; unused dependencies may be overcounted`);
                    }
                }
                else if (installRoot && result.spawnError === undefined) {
                    outcome.failedRoots.push(root);
                }
                else {
                    return unavailable(failure);
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
