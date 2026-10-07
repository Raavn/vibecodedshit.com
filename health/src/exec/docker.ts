import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
 * `docker run` argv for one step. Network is off unless the step needs it. The container runs as the host user, so
 * what a step writes into /work and /out stays removable on the host; HOME points at a directory any uid can write.
 */
export function dockerArgs(
  spec: StepSpec,
  name: string,
  runner: ExecutionConfig['runner'],
  user: HostUser | null = hostUser(),
): string[] {
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
    ...Object.entries(spec.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    '-v',
    `${spec.workDir}:/work`,
    '-v',
    `${spec.outDir}:/out`,
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

/** The real runner: one `docker run` per step. The timeout is enforced here with `docker kill`. */
export function createDockerRunner(runner: ExecutionConfig['runner'], spawn: Spawn = nodeSpawn): ExecRunner {
  return {
    async runStep(spec) {
      const name = `health-${randomBytes(4).toString('hex')}-${spec.label.replace(/[^A-Za-z0-9_.-]/g, '-')}`;
      const started = Date.now();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void run(spawn, ['kill', name]);
      }, spec.timeoutSeconds * 1000);
      const finished = await run(spawn, dockerArgs(spec, name, runner));
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
