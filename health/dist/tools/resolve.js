import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog } from './catalog.js';
/** Nearest `node_modules/<pkg>/package.json` above this file. */
function findPackageJson(pkg) {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const candidate = path.join(dir, 'node_modules', pkg, 'package.json');
        if (existsSync(candidate))
            return candidate;
        const parent = path.dirname(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
}
function resolveNpm(name, pkg) {
    const pkgJsonPath = findPackageJson(pkg);
    if (!pkgJsonPath)
        return undefined;
    const json = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const rel = typeof json.bin === 'string' ? json.bin : json.bin?.[pkg] ?? Object.values(json.bin ?? {})[0];
    if (!rel)
        return undefined;
    return {
        name,
        command: process.execPath,
        prefixArgs: [path.join(path.dirname(pkgJsonPath), rel)],
        version: json.version,
    };
}
function findOnPath(bin, env) {
    const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD').split(';') : [''];
    for (const dir of (env.PATH ?? '').split(path.delimiter)) {
        if (dir === '')
            continue;
        for (const ext of extensions) {
            const candidate = path.join(dir, bin + ext);
            try {
                accessSync(candidate, constants.X_OK);
                return candidate;
            }
            catch {
                // not here
            }
        }
    }
    return undefined;
}
export async function resolveTool(name, deps) {
    const entry = catalog[name];
    if (entry.kind === 'npm')
        return resolveNpm(name, entry.pkg);
    const exe = findOnPath(entry.bin, deps.env);
    if (!exe)
        return undefined;
    const result = spawnSync(exe, entry.versionArgs, { encoding: 'utf8', env: deps.env });
    if (result.error || result.status !== 0)
        return undefined;
    const match = entry.versionPattern.exec(`${result.stdout}\n${result.stderr}`);
    if (!match?.[1])
        return undefined;
    return { name, command: exe, prefixArgs: [], version: match[1] };
}
