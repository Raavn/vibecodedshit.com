import path from 'node:path';
import picomatch from 'picomatch';
/** Detection order of the D3 dimension file. */
const DETECTION_ORDER = ['nextjs', 'express', 'django', 'fastapi', 'generic'];
const LANGUAGES = { typescript_javascript: ['typescript', 'javascript'], python: ['python'] };
/**
 * The first preset in detection order whose `languages` include the group and whose detection predicate
 * (`matches[key]`, supplied by the language adapter) holds. `generic` is the fallback.
 */
export function choosePreset(methodology, group, matches) {
    for (const key of DETECTION_ORDER) {
        const preset = methodology.presets[key];
        if (!preset || !preset.languages.some((l) => LANGUAGES[group].includes(l)))
            continue;
        if (key === 'generic' || matches[key] === true)
            return preset;
    }
    throw new Error('methodology has no generic preset');
}
const MATCH_OPTIONS = { dot: true };
/** TypeScript and JavaScript match a glob with or without `src/`. Python passes its root package directories. */
const TS_PREFIXES = ['', 'src/'];
/** A glob `g` matches path `p` when `p` matches `prefix + g` for any of the prefixes (each empty or ending in `/`). */
export function globMatcher(globs, prefixes = TS_PREFIXES) {
    const matchers = prefixes.map((prefix) => picomatch(globs.map((g) => `${prefix}${g}`), MATCH_OPTIONS));
    return (rel) => matchers.some((match) => match(rel));
}
/** Leading literal directory segments of a glob (`app/**` has 1, `features/*` has 1, `**` has 0). */
function literalDepth(glob) {
    const segments = glob.split('/');
    let depth = 0;
    for (const segment of segments.slice(0, -1)) {
        if (/[*?[\]{}()!]/.test(segment))
            break;
        depth += 1;
    }
    return depth;
}
/**
 * The glob layer of each file (paths relative to the package directory): the layer with the longest
 * matching directory prefix, ties to the first layer listed. Files in no layer are absent.
 */
export function globLayers(layers, relFiles, prefixes = TS_PREFIXES) {
    const compiled = Object.entries(layers)
        .filter((entry) => Array.isArray(entry[1]))
        .map(([name, globs]) => ({
        name,
        entries: globs.map((glob) => ({ depth: literalDepth(glob), match: globMatcher([glob], prefixes) })),
    }));
    const result = new Map();
    for (const rel of relFiles) {
        let best;
        for (const layer of compiled) {
            for (const entry of layer.entries) {
                if (!entry.match(rel))
                    continue;
                const depth = entry.depth;
                if (!best || depth > best.depth)
                    best = { name: layer.name, depth };
            }
        }
        if (best)
            result.set(rel, best.name);
    }
    return result;
}
/** Directory (relative to the package) of the deepest module root containing the file, else undefined. */
export function moduleDirs(roots, relFiles, prefixes = TS_PREFIXES) {
    const isRoot = globMatcher(roots, prefixes);
    const known = new Map();
    const rootDir = (dir) => {
        let value = known.get(dir);
        if (value === undefined) {
            value = isRoot(dir);
            known.set(dir, value);
        }
        return value;
    };
    const result = new Map();
    for (const rel of relFiles) {
        let found;
        for (let dir = path.posix.dirname(rel); dir !== '.' && dir !== '/'; dir = path.posix.dirname(dir)) {
            if (rootDir(dir)) {
                found = dir;
                break;
            }
        }
        result.set(rel, found);
    }
    return result;
}
/** The entry glob that applies to the group. */
export function publicEntryGlob(preset, group) {
    const entry = preset.modules.public_entry;
    if (typeof entry === 'string')
        return entry;
    if (Array.isArray(entry))
        return undefined;
    return entry[group];
}
