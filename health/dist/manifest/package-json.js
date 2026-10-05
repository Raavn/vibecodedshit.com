import path from 'node:path';
import { readTracked } from '../scope/tracked.js';
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
function stringRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return {};
    return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === 'string'));
}
/** The `package.json` in `dir` (repo-relative, "." for the root). Missing or invalid JSON gives undefined. */
export function readPackageJson(repoPath, dir) {
    const text = readTracked(repoPath, path.posix.join(dir === '' ? '.' : dir, 'package.json'));
    if (text === null)
        return undefined;
    let json;
    try {
        json = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json))
        return undefined;
    const bag = json;
    const dependencies = {};
    for (const field of DEPENDENCY_FIELDS)
        Object.assign(dependencies, stringRecord(bag[field]));
    return {
        ...(typeof bag.name === 'string' ? { name: bag.name } : {}),
        scripts: stringRecord(bag.scripts),
        dependencies,
        engines: stringRecord(bag.engines),
        ...(bag.volta !== null && typeof bag.volta === 'object' ? { volta: bag.volta } : {}),
        ...(typeof bag.packageManager === 'string' ? { packageManager: bag.packageManager } : {}),
        ...(bag.workspaces === undefined ? {} : { workspaces: bag.workspaces }),
    };
}
