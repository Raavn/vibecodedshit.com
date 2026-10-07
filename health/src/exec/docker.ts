import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ToolError } from '../scope/types.js';
import type { ExecutionConfig } from '../methodology/schema.js';
import type { ExecRunner, StepOutcome, StepSpec } from './types.js';

export type Spawn = typeof nodeSpawn;

interface Finished {
  exitCode: number | null;
  stderr: string;
  spawnError?: string;
}

function run(spawn: Spawn, args: string[], onChild?: () => void): Promise<Finished> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    onChild?.();
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => resolve({ exitCode: null, stderr, spawnError: err.message }));
    child.on('close', (code) => resolve({ exitCode: code, stderr }));
  });
}

/** Host uid and gid, or null where the platform has none (Windows). */
export interface HostUser {
  uid: number;
  gid: number;
}
export const hostUser = (): HostUser | null =>
  process.getuid && process.getgid ? { uid: process.getuid(), gid: process.getgid() } : null;

/**
 * Download caches of every package manager the network-on steps use, under the /cache mount. Yarn (Berry) gets its
 * global folder only, so a repository's own cache folder (zero-installs) stays in use. pnpm keeps its store under PNPM_HOME.
 */
const CACHE_ENV: Record<string, string> = {
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
export function packageCacheDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string | null {
  const setting = env.HEALTH_PACKAGE_CACHE?.trim();
  if (setting === 'off') return null;
  if (setting) return path.resolve(setting);
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'health', 'packages');
}

/**
 * `docker run` argv for one step. Network is off unless the step needs it. The container runs as the host user, so
 * what a step writes into /work and /out stays removable on the host; HOME points at a directory any uid can write.
 * Network-on steps also mount the host package cache at /cache, so repeated scans do not download the same packages again.
 */
export function dockerArgs(
  spec: StepSpec,
  name: string,
  runner: ExecutionConfig['runner'],
  user: HostUser | null = hostUser(),
  cacheDir: string | null = null,
): string[] {
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

function toolError(finished: Finished, spec: StepSpec): ToolError | null {
  if (finished.spawnError !== undefined) return new ToolError(`docker could not start: ${finished.spawnError}`);
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
export function createDockerRunner(
  runner: ExecutionConfig['runner'],
  spawn: Spawn = nodeSpawn,
  cacheDir: string | null = packageCacheDir(),
): ExecRunner {
  return {
    async runStep(spec) {
      if (spec.network && cacheDir !== null) await mkdir(cacheDir, { recursive: true });
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

      if (timedOut) return { status: 'timeout', exitCode: null, durationMs, outputDir: spec.outDir } satisfies StepOutcome;
      const failure = toolError(finished, spec);
      if (failure) throw failure;
      return {
        status: finished.exitCode === 0 ? 'ok' : 'failed',
        exitCode: finished.exitCode,
        durationMs,
        outputDir: spec.outDir,
      };
    },
  };
}

/** `docker image inspect <tag> --format '{{.Id}}'`. A locally built image has no RepoDigest. */
export function imageDigest(tag: string, spawn: Spawn = nodeSpawn): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(new ToolError(`docker could not start: ${err.message}`)));
    child.on('close', (code) => {
      const digest = stdout.trim();
      if (code !== 0 || digest === '') {
        const detail = stderr.trim().split('\n').slice(-1)[0];
        reject(new ToolError(`image ${tag} is not available${detail ? `: ${detail}` : ''}. Build it with npm run image:build`));
      } else resolve(digest);
    });
  });
}
