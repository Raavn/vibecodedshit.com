import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { hostUser } from '../exec/docker.js';
import { catalog } from './catalog.js';
import { DEFAULT_TIMEOUT_MS } from './kit.js';
function imageEntry(name) {
    const entry = catalog[name];
    const base = entry.kind === 'npm'
        ? { bin: entry.pkg, versionArgs: ['--version'], versionPattern: /(\d+\.\d+\.\d+\S*)/ }
        : { bin: entry.bin, versionArgs: entry.versionArgs, versionPattern: entry.versionPattern };
    return {
        ...base,
        // osv-scanner looks advisories up on osv.dev; every other tool runs with the network off.
        network: name === 'osv-scanner',
        // import-linter's uv tool environment, which also holds grimp for python/graph_helper.py.
        ...(name === 'import-linter' ? { interpreter: '/opt/uv-tools/import-linter/bin/python' } : {}),
    };
}
function inside(child, parent) {
    return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
}
/**
 * Host directories a tool run needs, each mounted at the same path in the container so every absolute path in the
 * argv, the reports and the working directory means the same thing on both sides. Candidates are the working
 * directory and every absolute argument (also the part after `kind:` in `requirements.txt:/abs/path`): an existing
 * directory is mounted itself, an existing file or a file still to be written through its directory. Nested
 * directories collapse into the outermost one. Directories inside the scanned repository are read-only.
 */
export function mountsFor(args, cwd, repoPath) {
    const candidates = [cwd];
    for (const arg of args) {
        if (path.isAbsolute(arg))
            candidates.push(arg);
        const colon = arg.indexOf(':');
        if (colon > 0 && path.isAbsolute(arg.slice(colon + 1)))
            candidates.push(arg.slice(colon + 1));
    }
    const dirs = new Set();
    for (const candidate of candidates) {
        const abs = path.resolve(candidate);
        if (existsSync(abs))
            dirs.add(statSync(abs).isDirectory() ? abs : path.dirname(abs));
        else if (existsSync(path.dirname(abs)))
            dirs.add(path.dirname(abs));
    }
    const sorted = [...dirs].sort((a, b) => a.length - b.length || a.localeCompare(b));
    const kept = [];
    for (const dir of sorted)
        if (!kept.some((k) => inside(dir, k)))
            kept.push(dir);
    const repo = path.resolve(repoPath);
    return kept.map((dir) => ({ dir, readOnly: inside(dir, repo) }));
}
/** git inside the image runs as the host uid on files it may not own; gitleaks reads history through it. */
const GIT_SAFE_ENV = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' };
/**
 * The full-run tool kit: every static tool runs in the pinned image (`runner.image`), one `docker run` per call, as
 * the host user with `HOME=/tmp`, bounded like an execution step, network off except for osv-scanner. Versions are
 * the ones the image reports, so a run records what actually measured. The host needs Docker, nothing else.
 */
export function createImageToolKit(deps) {
    const spawn = deps.spawn ?? nodeSpawn;
    const user = deps.user === undefined ? hostUser() : deps.user;
    const { runner } = deps;
    const versions = new Map();
    const memos = new Map();
    const resolved = new Map();
    function docker(argv, name, timeoutMs) {
        return new Promise((resolve) => {
            const child = spawn('docker', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
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
                spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => undefined);
            }, timeoutMs);
            child.stdout?.on('data', (chunk) => {
                stdout += chunk.toString('utf8');
            });
            child.stderr?.on('data', (chunk) => {
                stderr += chunk.toString('utf8');
            });
            child.on('error', (err) => finish({ exitCode: null, stdout, stderr, timedOut, spawnError: `docker could not start: ${err.message}` }));
            child.on('close', (code) => {
                // 125: docker itself failed; 126 and 127: the command is not runnable or not in the image.
                if (!timedOut && code !== null && [125, 126, 127].includes(code)) {
                    const detail = stderr.trim().split('\n').slice(-2).join(' | ');
                    finish({ exitCode: code, stdout, stderr, timedOut, spawnError: `could not run in the image ${runner.image} (exit ${code})${detail ? `: ${detail}` : ''}` });
                }
                else
                    finish({ exitCode: code, stdout, stderr, timedOut });
            });
        });
    }
    /** `docker run` options up to the image. Without `cwd` nothing is mounted. */
    function containerArgs(name, network, cwd, mountArgs, env) {
        const mounts = cwd === null ? [] : mountsFor(mountArgs, cwd, deps.repoPath);
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
            ...(user ? ['--user', `${user.uid}:${user.gid}`] : []),
            '-e',
            'HOME=/tmp',
            ...(network ? [] : ['--network', 'none']),
            ...Object.entries({ ...GIT_SAFE_ENV, ...env }).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
            ...mounts.flatMap((m) => ['-v', `${m.dir}:${m.dir}${m.readOnly ? ':ro' : ''}`]),
            ...(cwd === null ? [] : ['-w', path.resolve(cwd)]),
            runner.image,
        ];
    }
    const containerName = (tool) => `health-${randomBytes(4).toString('hex')}-${tool}`;
    async function resolveInImage(name) {
        const entry = imageEntry(name);
        const container = containerName(name);
        const result = await docker([...containerArgs(container, false, null, [], {}), entry.bin, ...entry.versionArgs], container, 60_000);
        if (result.spawnError !== undefined || result.exitCode !== 0)
            return undefined;
        const match = entry.versionPattern.exec(`${result.stdout}\n${result.stderr}`);
        if (!match?.[1])
            return undefined;
        return { name, command: entry.bin, prefixArgs: [], version: match[1], ...(entry.interpreter ? { interpreter: entry.interpreter } : {}) };
    }
    const kit = {
        resolve(name) {
            let found = resolved.get(name);
            if (!found) {
                found = resolveInImage(name).then((tool) => {
                    if (tool)
                        versions.set(name, tool.version);
                    return tool;
                });
                resolved.set(name, found);
            }
            return found;
        },
        run(tool, args, opts) {
            const container = containerName(tool.name);
            const argv = [...tool.prefixArgs, ...args];
            return docker([...containerArgs(container, imageEntry(tool.name).network, opts.cwd, argv, opts.env ?? {}), tool.command, ...argv], container, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        },
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
        notFoundReason(name) {
            return `${name} is not in the image ${runner.image}, rebuild it: npm run image:build`;
        },
    };
    return kit;
}
