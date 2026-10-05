import { spawn as nodeSpawn } from 'node:child_process';
import { resolveTool } from './resolve.js';
/** Same as the typecheck and lint timeouts in methodology.yaml. */
export const DEFAULT_TIMEOUT_MS = 600_000;
export function createToolKit(deps = {}) {
    const spawn = deps.spawn ?? nodeSpawn;
    const env = deps.env ?? process.env;
    const versions = new Map();
    const memos = new Map();
    function run(tool, args, opts) {
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
            const finish = (result) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve(result);
            };
            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
            }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
            child.stdout?.on('data', (chunk) => {
                stdout += chunk.toString('utf8');
            });
            child.stderr?.on('data', (chunk) => {
                stderr += chunk.toString('utf8');
            });
            child.on('error', (err) => finish({ exitCode: null, stdout, stderr, timedOut, spawnError: err.message }));
            child.on('close', (code) => finish({ exitCode: code, stdout, stderr, timedOut }));
        });
    }
    const kit = {
        async resolve(name) {
            const found = await resolveTool(name, { spawn, env });
            if (found)
                versions.set(name, found.version);
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
        memo(key, make) {
            const cached = memos.get(key);
            if (cached)
                return cached;
            const made = make();
            memos.set(key, made);
            return made;
        },
    };
    return kit;
}
