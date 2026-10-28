import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ToolError } from '../scope/types.js';
function run(spawn, args, onChild) {
    return new Promise((resolve) => {
        const child = spawn('docker', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        onChild?.();
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => resolve({ exitCode: null, stderr, spawnError: err.message }));
        child.on('close', (code) => resolve({ exitCode: code, stderr }));
    });
}
export const hostUser = () => process.getuid && process.getgid ? { uid: process.getuid(), gid: process.getgid() } : null;
/**
 * Download caches of every package manager the network-on steps use, under the /cache mount. Yarn (Berry) gets its
 * global folder only, so a repository's own cache folder (zero-installs) stays in use. pnpm keeps its store under PNPM_HOME.
 */
const CACHE_ENV = {
    npm_config_cache: '/cache/npm',
    PNPM_HOME: '/cache/pnpm',
    YARN_GLOBAL_FOLDER: '/cache/yarn',
    BUN_INSTALL_CACHE_DIR: '/cache/bun',
    PIP_CACHE_DIR: '/cache/pip',
    UV_CACHE_DIR: '/cache/uv',
    POETRY_CACHE_DIR: '/cache/poetry',
    PDM_CACHE_DIR: '/cache/pdm',
    PIPENV_CACHE_DIR: '/cache/pipenv',
};
/**
 * Host directory for the package caches: `HEALTH_PACKAGE_CACHE`, or `off` for none, else `$XDG_CACHE_HOME/health/packages`,
 * else `~/.cache/health/packages`. The cache only saves downloads: lockfiles and integrity checks decide what is installed.
 */
export function packageCacheDir(env = process.env, home = homedir()) {
    const setting = env.HEALTH_PACKAGE_CACHE?.trim();
    if (setting === 'off')
        return null;
    if (setting)
        return path.resolve(setting);
    return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'health', 'packages');
}
/**
 * `docker run` argv for one step. Network is off unless the step needs it. The container runs as the host user, so
 * what a step writes into /work and /out stays removable on the host; HOME points at a directory any uid can write.
 * Network-on steps also mount the host package cache at /cache, so repeated scans do not download the same packages again.
 */
export function dockerArgs(spec, name, runner, user = hostUser(), cacheDir = null) {
    const cache = spec.network && cacheDir !== null;
    return [
        'run',
        '--rm',
        '--pull',
        'never',
        '--name',
        name,
        '--cpus',
        String(runner.cpus),
        '--memory',
        `${runner.memory_gb}g`,
        ...(user ? ['--user', `${user.uid}:${user.gid}`, '-e', 'HOME=/tmp'] : []),
        ...(spec.network ? [] : ['--network', 'none']),
        ...(cache ? Object.entries(CACHE_ENV).flatMap(([key, value]) => ['-e', `${key}=${value}`]) : []),
        ...Object.entries(spec.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
        '-v',
        `${spec.workDir}:/work`,
        '-v',
        `${spec.outDir}:/out`,
        ...(cache ? ['-v', `${cacheDir}:/cache`] : []),
        '-w',
        spec.cwd === '.' ? '/work' : `/work/${spec.cwd}`,
        runner.image,
        ...spec.argv,
    ];
}
function toolError(finished, spec) {
    if (finished.spawnError !== undefined)
        return new ToolError(`docker could not start: ${finished.spawnError}`);
    if (finished.exitCode !== null && [125, 126, 127].includes(finished.exitCode)) {
        const detail = finished.stderr.trim().split('\n').slice(-2).join(' | ');
        return new ToolError(`${spec.step} could not run in the image (exit ${finished.exitCode})${detail ? `: ${detail}` : ''}`);
    }
    return null;
}
/**
 * The real runner: one `docker run` per step. The timeout is enforced here with `docker kill`. The cache directory is
 * created before a network-on step, so Docker does not create it as root.
 */
export function createDockerRunner(runner, spawn = nodeSpawn, cacheDir = packageCacheDir()) {
    return {
        async runStep(spec) {
            if (spec.network && cacheDir !== null)
                await mkdir(cacheDir, { recursive: true });
            const name = `health-${randomBytes(4).toString('hex')}-${spec.label.replace(/[^A-Za-z0-9_.-]/g, '-')}`;
            const started = Date.now();
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                void run(spawn, ['kill', name]);
            }, spec.timeoutSeconds * 1000);
            const finished = await run(spawn, dockerArgs(spec, name, runner, hostUser(), cacheDir));
            clearTimeout(timer);
            const durationMs = Date.now() - started;
            if (timedOut)
                return { status: 'timeout', exitCode: null, durationMs, outputDir: spec.outDir };
            const failure = toolError(finished, spec);
            if (failure)
                throw failure;
            return {
                status: finished.exitCode === 0 ? 'ok' : 'failed',
                exitCode: finished.exitCode,
                durationMs,
                outputDir: spec.outDir,
            };
        },
    };
}
/**
 * The image label a full scan checks. Bump it with `LABEL dev.vibecodedshit.health.revision` in docker/Dockerfile
 * whenever the tools a full run needs from the image change, so an image built before the change is rebuilt.
 */
export const IMAGE_REVISION_LABEL = 'dev.vibecodedshit.health.revision';
export const IMAGE_REVISION = '2';
/**
 * `docker image inspect <tag>`: the image id (a locally built image has no RepoDigest). An image whose revision label
 * is not IMAGE_REVISION lacks tools this version runs in it, so it is a ToolError like a missing image.
 */
export function imageDigest(tag, spawn = nodeSpawn) {
    return new Promise((resolve, reject) => {
        const format = `{{.Id}} {{index .Config.Labels "${IMAGE_REVISION_LABEL}"}}`;
        const child = spawn('docker', ['image', 'inspect', tag, '--format', format], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => reject(new ToolError(`docker could not start: ${err.message}`)));
        child.on('close', (code) => {
            const [digest = '', revision = ''] = stdout.trim().split(/\s+/);
            if (code !== 0 || digest === '') {
                const detail = stderr.trim().split('\n').slice(-1)[0];
                reject(new ToolError(`image ${tag} is not available${detail ? `: ${detail}` : ''}. Build it with npm run image:build`));
            }
            else if (revision !== IMAGE_REVISION) {
                reject(new ToolError(`image ${tag} is out of date (revision ${revision || 'none'}, this version needs ${IMAGE_REVISION}). Rebuild it with npm run image:build`));
            }
            else
                resolve(digest);
        });
    });
}
