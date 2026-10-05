import { readFileSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { parse } from 'yaml';
function readIfPresent(file) {
    try {
        return readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
}
function workspacePatterns(repoPath) {
    const patterns = [];
    const pkg = readIfPresent(path.join(repoPath, 'package.json'));
    if (pkg !== null) {
        try {
            const json = JSON.parse(pkg);
            const ws = json.workspaces;
            if (Array.isArray(ws))
                patterns.push(...ws.filter((w) => typeof w === 'string'));
            else if (ws && typeof ws === 'object' && 'packages' in ws && Array.isArray(ws.packages)) {
                patterns.push(...ws.packages.filter((w) => typeof w === 'string'));
            }
        }
        catch {
            // A malformed package.json declares no workspaces.
        }
    }
    const pnpm = readIfPresent(path.join(repoPath, 'pnpm-workspace.yaml'));
    if (pnpm !== null) {
        try {
            const doc = parse(pnpm);
            if (doc && Array.isArray(doc.packages)) {
                patterns.push(...doc.packages.filter((w) => typeof w === 'string'));
            }
        }
        catch {
            // Ignore a malformed pnpm-workspace.yaml.
        }
    }
    const pyproject = readIfPresent(path.join(repoPath, 'pyproject.toml'));
    if (pyproject !== null) {
        const section = /\[tool\.uv\.workspace\]([\s\S]*?)(?:\n\[|$)/.exec(pyproject);
        const members = section?.[1] ? /members\s*=\s*\[([\s\S]*?)\]/.exec(section[1]) : null;
        if (members?.[1]) {
            for (const match of members[1].matchAll(/["']([^"']+)["']/g)) {
                if (match[1])
                    patterns.push(match[1]);
            }
        }
    }
    return patterns;
}
/**
 * Workspace package directories (repo-relative posix, never "."), found from
 * workspace declarations and from directories that have their own pyproject.toml.
 */
export function detectPackages(repoPath, trackedFiles) {
    const patterns = workspacePatterns(repoPath).map((p) => p.replace(/^\.\//, '').replace(/\/+$/, ''));
    const positive = patterns.filter((p) => !p.startsWith('!'));
    const negative = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
    const matchesDeclared = positive.length > 0 ? picomatch(positive, { dot: true, ignore: negative }) : null;
    const found = new Set();
    for (const file of trackedFiles) {
        const base = path.posix.basename(file);
        if (base !== 'package.json' && base !== 'pyproject.toml')
            continue;
        const dir = path.posix.dirname(file);
        if (dir === '.')
            continue;
        if (base === 'pyproject.toml')
            found.add(dir);
        else if (matchesDeclared?.(dir))
            found.add(dir);
    }
    return [...found].sort();
}
/** Deepest package directory containing the file, else ".". */
export function packageOf(file, packages) {
    let best = '.';
    for (const pkg of packages) {
        if (file.startsWith(`${pkg}/`) && (best === '.' || pkg.length > best.length))
            best = pkg;
    }
    return best;
}
