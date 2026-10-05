import path from 'node:path';
import semver from 'semver';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';
import { normalizeName, satisfies as pySatisfies } from '../../util/pep440.js';
import { readToml } from '../../util/toml.js';
import { requirementLines } from './declared.js';
import { readTrackedText, trackedIn } from './files.js';
export function kindGroup(kind) {
    return ['uv', 'poetry', 'pdm', 'pipfile', 'requirements'].includes(kind) ? 'python' : 'typescript_javascript';
}
const NAMED = {
    'package-lock.json': 'package-lock',
    'npm-shrinkwrap.json': 'npm-shrinkwrap',
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'bun.lock': 'bun',
    'uv.lock': 'uv',
    'poetry.lock': 'poetry',
    'pdm.lock': 'pdm',
    'Pipfile.lock': 'pipfile',
};
const MISSING = { present: false, versions: [], specifierOk: true };
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function str(value) {
    return typeof value === 'string' ? value : undefined;
}
function found(version, specifierOk = true) {
    return { present: true, versions: version === undefined ? [] : [version], specifierOk };
}
// ---- npm --------------------------------------------------------------------------------
function npmReader(json) {
    const packages = record(json.packages);
    const tree = record(json.dependencies);
    return {
        lookup(dep, pkgDir) {
            if (packages) {
                let dir = pkgDir;
                for (;;) {
                    const entry = record(packages[dir === '' ? `node_modules/${dep.name}` : `${dir}/node_modules/${dep.name}`]);
                    if (entry) {
                        const target = entry.link === true ? record(packages[str(entry.resolved) ?? '']) : undefined;
                        return found(str(target?.version) ?? str(entry.version));
                    }
                    if (dir === '')
                        break;
                    dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
                }
                return MISSING;
            }
            const entry = record(tree?.[dep.name]);
            return entry ? found(str(entry.version)) : MISSING;
        },
    };
}
// ---- pnpm -------------------------------------------------------------------------------
function pnpmVersion(raw) {
    if (raw.startsWith('link:') || raw.startsWith('file:'))
        return undefined;
    return raw.replace(/\(.*$/, '').replace(/_.*$/, '');
}
function pnpmReader(doc) {
    const importers = record(doc.importers);
    return {
        lookup(dep, pkgDir) {
            const section = importers ? record(importers[pkgDir === '' ? '.' : pkgDir]) : doc;
            if (!section)
                return MISSING;
            const specifiers = record(section.specifiers);
            for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
                const entry = record(section[key])?.[dep.name];
                if (entry === undefined)
                    continue;
                if (typeof entry === 'string')
                    return found(pnpmVersion(entry), str(specifiers?.[dep.name]) === dep.spec);
                const table = record(entry);
                const version = str(table?.version);
                return found(version === undefined ? undefined : pnpmVersion(version), str(table?.specifier) === dep.spec);
            }
            return MISSING;
        },
    };
}
// ---- yarn -------------------------------------------------------------------------------
function yarnReader(text) {
    const entries = new Map();
    const names = new Set();
    let keys = [];
    for (const line of text.split(/\r?\n/)) {
        if (line === '' || line.startsWith('#'))
            continue;
        if (!/^\s/.test(line)) {
            keys = [];
            if (!line.endsWith(':') || line.startsWith('__metadata'))
                continue;
            for (const part of line.slice(0, -1).split(',')) {
                const key = part.trim().replace(/^"|"$/g, '');
                const at = key.indexOf('@', 1);
                if (at === -1)
                    continue;
                const name = key.slice(0, at);
                const range = key.slice(at + 1).replace(/^npm:/, '');
                names.add(name);
                keys.push(`${name}@${range}`);
                entries.set(`${name}@${range}`, undefined);
            }
            continue;
        }
        const m = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
        if (m?.[1])
            for (const key of keys)
                entries.set(key, m[1]);
    }
    return {
        lookup(dep) {
            if (!dep.registry)
                return names.has(dep.name) ? found(undefined) : MISSING;
            const key = `${dep.name}@${dep.spec}`;
            return entries.has(key) ? found(entries.get(key)) : MISSING;
        },
    };
}
// ---- bun --------------------------------------------------------------------------------
function bunReader(doc) {
    const workspaces = record(doc.workspaces);
    const packages = record(doc.packages);
    return {
        lookup(dep, pkgDir) {
            const workspace = record(workspaces?.[pkgDir]);
            let specifier;
            for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
                specifier ??= str(record(workspace?.[key])?.[dep.name]);
            }
            const tuple = packages?.[dep.name];
            if (specifier === undefined && tuple === undefined)
                return MISSING;
            const id = Array.isArray(tuple) ? str(tuple[0]) : undefined;
            const version = id !== undefined && id.lastIndexOf('@') > 0 ? id.slice(id.lastIndexOf('@') + 1) : undefined;
            return found(version, specifier === undefined || specifier === dep.spec);
        },
    };
}
// ---- Python -----------------------------------------------------------------------------
function tomlReader(absPath) {
    const doc = readToml(absPath);
    if (!doc || !Array.isArray(doc.package))
        return undefined;
    const byName = new Map();
    for (const entry of doc.package) {
        const table = record(entry);
        const name = str(table?.name);
        if (name === undefined)
            continue;
        const version = str(table?.version);
        const list = byName.get(normalizeName(name)) ?? [];
        if (version !== undefined)
            list.push(version);
        byName.set(normalizeName(name), list);
    }
    return {
        lookup(dep) {
            const versions = byName.get(dep.name);
            return versions === undefined ? MISSING : { present: true, versions, specifierOk: true };
        },
    };
}
function pipfileLockReader(json) {
    return {
        lookup(dep) {
            for (const section of ['default', 'develop']) {
                for (const [rawName, entry] of Object.entries(record(json[section]) ?? {})) {
                    if (normalizeName(rawName) !== dep.name)
                        continue;
                    const version = str(record(entry)?.version)?.replace(/^==/, '');
                    return found(version);
                }
            }
            return MISSING;
        },
    };
}
/** `name==version` for every requirement of a hashed, fully pinned requirements file, else undefined. */
export function pinnedRequirements(text) {
    const lines = requirementLines(text);
    if (lines.length === 0)
        return undefined;
    const pinned = new Map();
    for (const { line, hashed } of lines) {
        const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*==\s*([^\s;=!<>~,]+)\s*(?:;.*)?$/.exec(line);
        if (!hashed || !m?.[1] || !m[2] || m[2].endsWith('.*'))
            return undefined;
        pinned.set(normalizeName(m[1]), m[2]);
    }
    return pinned;
}
function requirementsReader(pinned) {
    return {
        lookup(dep) {
            const version = pinned.get(dep.name);
            return version === undefined ? MISSING : found(version);
        },
    };
}
// ---- search and parse -------------------------------------------------------------------
/**
 * Lockfiles of the unit's group in the nearest directory (the package directory, then each
 * ancestor) that holds any. Every kind found in that directory is a candidate.
 */
export function findLockfiles(repoPath, pkg, group) {
    let dir = pkg === '.' ? '' : pkg;
    for (;;) {
        const candidates = [];
        for (const file of trackedIn(repoPath, dir)) {
            const base = path.posix.basename(file);
            const kind = NAMED[base];
            if (kind !== undefined && kindGroup(kind) === group)
                candidates.push({ path: file, dir, kind });
            else if (group === 'python' && /^requirements.*\.txt$/.test(base)) {
                const text = readTrackedText(repoPath, file);
                if (text !== null && pinnedRequirements(text) !== undefined)
                    candidates.push({ path: file, dir, kind: 'requirements' });
            }
        }
        if (candidates.length > 0)
            return candidates;
        if (dir === '')
            return [];
        dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
}
export function lockfileKind(file) {
    return NAMED[path.posix.basename(file)];
}
function parseJson(text) {
    try {
        return record(JSON.parse(text));
    }
    catch {
        return undefined;
    }
}
/** Parse a lockfile. Undefined when it cannot be read or parsed (it then counts as out of sync). */
export function readLockfile(repoPath, ref) {
    const text = readTrackedText(repoPath, ref.path);
    if (text === null)
        return undefined;
    const abs = path.join(path.resolve(repoPath), ref.path);
    switch (ref.kind) {
        case 'package-lock':
        case 'npm-shrinkwrap': {
            const json = parseJson(text);
            return json ? npmReader(json) : undefined;
        }
        case 'pnpm': {
            try {
                const doc = record(parseYaml(text));
                return doc ? pnpmReader(doc) : undefined;
            }
            catch {
                return undefined;
            }
        }
        case 'yarn':
            return yarnReader(text);
        case 'bun': {
            const parsed = ts.parseConfigFileTextToJson(ref.path, text);
            const doc = record(parsed.config);
            return doc ? bunReader(doc) : undefined;
        }
        case 'uv':
        case 'poetry':
        case 'pdm':
            return tomlReader(abs);
        case 'pipfile': {
            const json = parseJson(text);
            return json ? pipfileLockReader(json) : undefined;
        }
        case 'requirements': {
            const pinned = pinnedRequirements(text);
            return pinned ? requirementsReader(pinned) : undefined;
        }
    }
}
export function entrySatisfies(dep, entry, group) {
    if (!entry.present)
        return false;
    if (!dep.registry)
        return true;
    if (!entry.specifierOk)
        return false;
    if (group === 'python')
        return entry.versions.some((v) => pySatisfies(v, dep.spec));
    return entry.versions.some((v) => semver.satisfies(v, dep.spec, { includePrerelease: true }));
}
