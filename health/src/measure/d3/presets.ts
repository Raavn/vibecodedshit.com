import path from 'node:path';
import picomatch from 'picomatch';
import type { Methodology } from '../../methodology/load.js';
import type { Preset, PresetKey } from '../../methodology/schema.js';
import type { Group } from '../../scope/types.js';

/** Detection order of the D3 dimension file. */
export const DETECTION_ORDER: PresetKey[] = ['nextjs', 'express', 'django', 'fastapi', 'generic'];

const LANGUAGES: Record<Group, string[]> = { typescript_javascript: ['typescript', 'javascript'], python: ['python'] };

/**
 * The first preset in detection order whose `languages` include the group and whose detection predicate
 * (`matches[key]`, supplied by the language adapter) holds. `generic` is the fallback.
 */
export function choosePreset(methodology: Methodology, group: Group, matches: Partial<Record<PresetKey, boolean>>): Preset {
  for (const key of DETECTION_ORDER) {
    const preset = methodology.presets[key];
    if (!preset || !preset.languages.some((l) => LANGUAGES[group].includes(l))) continue;
    if (key === 'generic' || matches[key] === true) return preset;
  }
  throw new Error('methodology has no generic preset');
}

const MATCH_OPTIONS = { dot: true } as const;

/** TypeScript and JavaScript match a glob with or without `src/`. Python passes its root package directories. */
export const TS_PREFIXES = ['', 'src/'];

/** A glob `g` matches path `p` when `p` matches `prefix + g` for any of the prefixes (each empty or ending in `/`). */
export function globMatcher(globs: string[], prefixes: string[] = TS_PREFIXES): (rel: string) => boolean {
  const matchers = prefixes.map((prefix) => picomatch(globs.map((g) => `${prefix}${g}`), MATCH_OPTIONS));
  return (rel) => matchers.some((match) => match(rel));
}

/** Leading literal directory segments of a glob (`app/**` has 1, `features/*` has 1, `**` has 0). */
function literalDepth(glob: string): number {
  const segments = glob.split('/');
  let depth = 0;
  for (const segment of segments.slice(0, -1)) {
    if (/[*?[\]{}()!]/.test(segment)) break;
    depth += 1;
  }
  return depth;
}

/**
 * The glob layer of each file (paths relative to the package directory): the layer with the longest
 * matching directory prefix, ties to the first layer listed. Files in no layer are absent.
 */
export function globLayers(
  layers: Record<string, string[] | string>,
  relFiles: string[],
  prefixes: string[] = TS_PREFIXES,
): Map<string, string> {
  const compiled = Object.entries(layers)
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
    .map(([name, globs]) => ({
      name,
      entries: globs.map((glob) => ({ depth: literalDepth(glob), match: globMatcher([glob], prefixes) })),
    }));
  const result = new Map<string, string>();
  for (const rel of relFiles) {
    let best: { name: string; depth: number } | undefined;
    for (const layer of compiled) {
      for (const entry of layer.entries) {
        if (!entry.match(rel)) continue;
        const depth = entry.depth;
        if (!best || depth > best.depth) best = { name: layer.name, depth };
      }
    }
    if (best) result.set(rel, best.name);
  }
  return result;
}

/** Directory (relative to the package) of the deepest module root containing the file, else undefined. */
export function moduleDirs(roots: string[], relFiles: string[], prefixes: string[] = TS_PREFIXES): Map<string, string | undefined> {
  const isRoot = globMatcher(roots, prefixes);
  const known = new Map<string, boolean>();
  const rootDir = (dir: string): boolean => {
    let value = known.get(dir);
    if (value === undefined) {
      value = isRoot(dir);
      known.set(dir, value);
    }
    return value;
  };
  const result = new Map<string, string | undefined>();
  for (const rel of relFiles) {
    let found: string | undefined;
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
export function publicEntryGlob(preset: Preset, group: Group): string | undefined {
  const entry = preset.modules.public_entry;
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) return undefined;
  return entry[group];
}
