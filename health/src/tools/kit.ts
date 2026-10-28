import { spawn as nodeSpawn } from 'node:child_process';
import { catalog } from './catalog.js';
import { resolveTool } from './resolve.js';

export type ToolName = 'jscpd' | 'knip' | 'complexipy' | 'vulture' | 'deptry' | 'osv-scanner' | 'gitleaks' | 'import-linter';

export interface ResolvedTool {
  name: ToolName;
  command: string;
  prefixArgs: string[];
  version: string;
  /** import-linter in the image: the Python interpreter of its environment, which also holds grimp. */
  interpreter?: string;
}

export interface ToolResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ToolKit {
  resolve(name: ToolName): Promise<ResolvedTool | undefined>;
  run(tool: ResolvedTool, args: string[], opts: RunOptions): Promise<ToolResult>;
  fetch: typeof fetch;
  recordVersion(name: string, version: string): void;
  versions(): Record<string, string>;
  memo<T>(key: string, make: () => Promise<T>): Promise<T>;
  /** Why `resolve` found nothing, with how to get the tool where this kit looks for it. */
  notFoundReason(name: ToolName): string;
}

/** Same as the typecheck and lint timeouts in methodology.yaml. */
export const DEFAULT_TIMEOUT_MS = 600_000;

export interface KitDeps {
  spawn?: typeof nodeSpawn;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export function createToolKit(deps: KitDeps = {}): ToolKit {
  const spawn = deps.spawn ?? nodeSpawn;
  const env = deps.env ?? process.env;
  const versions = new Map<string, string>();
  const memos = new Map<string, Promise<unknown>>();

  function run(tool: ResolvedTool, args: string[], opts: RunOptions): Promise<ToolResult> {
    return new Promise((resolve) => {
      const child = spawn(tool.command, [...tool.prefixArgs, ...args], {
        cwd: opts.cwd,
        env: { ...env, ...opts.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const finish = (result: ToolResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => finish({ exitCode: null, stdout, stderr, timedOut, spawnError: err.message }));
      child.on('close', (code) => finish({ exitCode: code, stdout, stderr, timedOut }));
    });
  }

  const kit: ToolKit = {
    async resolve(name) {
      const found = await resolveTool(name, { spawn, env });
      if (found) versions.set(name, found.version);
      return found;
    },
    run,
    fetch: deps.fetch ?? globalThis.fetch,
    recordVersion(name, version) {
      versions.set(name, version);
    },
    versions() {
      return Object.fromEntries([...versions].sort(([a], [b]) => a.localeCompare(b)));
    },
    memo<T>(key: string, make: () => Promise<T>): Promise<T> {
      const cached = memos.get(key);
      if (cached) return cached as Promise<T>;
      const made = make();
      memos.set(key, made);
      return made;
    },
    notFoundReason(name) {
      return `${name} not found, install: ${catalog[name].install}`;
    },
  };
  return kit;
}
