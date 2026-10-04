import { existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const STRICT_FAMILY = [
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'noImplicitThis',
  'useUnknownInCatchVariables',
  'alwaysStrict',
] as const;

export type TsLevel = 'none' | 'partial' | 'strict' | 'strict_plus';
const LEVEL_ORDER: TsLevel[] = ['none', 'partial', 'strict', 'strict_plus'];

export interface TsConfigInfo {
  /** Absolute path, posix separators. */
  file: string;
  options: ts.CompilerOptions;
  /** Absolute posix paths of the files the config covers. */
  fileNames: Set<string>;
  /** Absolute posix paths of referenced configs. */
  references: string[];
  /** `files: []` with `references`: a solution-style config that is not evaluated itself. */
  solution: boolean;
  /** Targets of `extends` that could not be resolved. */
  missingExtends: string[];
}

export type ConfigCache = Map<string, TsConfigInfo | undefined>;

const posix = (p: string): string => p.split(path.sep).join('/');

const host: ts.ParseConfigFileHost = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: () => undefined,
};

/** Parse one tsconfig or jsconfig with `extends` resolved by the TypeScript API. JSON only, nothing is executed. */
export function loadTsConfig(file: string, cache: ConfigCache): TsConfigInfo | undefined {
  const key = posix(file);
  if (cache.has(key)) return cache.get(key);
  let info: TsConfigInfo | undefined;
  const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, host);
  if (parsed) {
    const raw = parsed.raw as { files?: unknown } | undefined;
    const references = (parsed.projectReferences ?? []).map((ref) => {
      const resolved = ts.resolveProjectReferencePath(ref);
      return posix(resolved);
    });
    const missingExtends: string[] = [];
    for (const error of parsed.errors) {
      if (error.code !== 6053) continue; // File '{0}' not found.
      const match = /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
      if (match?.[1]) missingExtends.push(match[1]);
    }
    info = {
      file: key,
      options: parsed.options,
      fileNames: new Set(parsed.fileNames.map(posix)),
      references,
      solution: Array.isArray(raw?.files) && raw.files.length === 0 && references.length > 0,
      missingExtends,
    };
  }
  cache.set(key, info);
  return info;
}

/** The level a set of compiler options declares: every flag is its explicit value, else `strict`, else false. */
export function levelOf(options: ts.CompilerOptions): TsLevel {
  const bag = options as Record<string, unknown>;
  const strict = bag.strict === true;
  const effective = (flag: string): boolean => (typeof bag[flag] === 'boolean' ? bag[flag] === true : strict);
  const turnedOff = STRICT_FAMILY.some((flag) => bag[flag] === false);
  if (strict && !turnedOff) return options.noUncheckedIndexedAccess === true ? 'strict_plus' : 'strict';
  return STRICT_FAMILY.some(effective) ? 'partial' : 'none';
}

export function lowestLevel(levels: TsLevel[]): TsLevel {
  return levels.reduce<TsLevel>((low, level) => (LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(low) ? level : low), 'strict_plus');
}

function reachable(root: TsConfigInfo, cache: ConfigCache): TsConfigInfo[] {
  const seen = new Set<string>([root.file]);
  const out: TsConfigInfo[] = [];
  const queue = [...root.references];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    const info = loadTsConfig(next, cache);
    if (!info) continue;
    out.push(info);
    queue.push(...info.references);
  }
  return out;
}

function covers(config: TsConfigInfo, files: Set<string>): boolean {
  for (const file of config.fileNames) if (files.has(file)) return true;
  return false;
}

function configIn(dir: string): string | undefined {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface UnitConfigs {
  /** The configs whose options apply to the unit. Empty means the unit has no config. */
  configs: TsConfigInfo[];
  /** Every config that was read, for missing-`extends` warnings. */
  read: TsConfigInfo[];
}

/**
 * The configs that apply to one unit: the package's own `tsconfig.json`, else its `jsconfig.json`,
 * else the nearest ancestor config up to the repository root, kept only if it (or a config it
 * references) covers a logic file of the unit. A solution-style config is replaced by the configs
 * reachable through its `references` that cover a logic file of the unit (the config itself if none do).
 */
export function unitConfigs(repoPath: string, packageDir: string, logicFiles: string[], cache: ConfigCache): UnitConfigs {
  const files = new Set(logicFiles.map((f) => posix(path.resolve(repoPath, f))));
  const root = path.resolve(repoPath);
  const start = path.resolve(repoPath, packageDir);

  let chosen: string | undefined = configIn(start);
  let ancestor = false;
  if (!chosen) {
    ancestor = true;
    for (let dir = path.dirname(start); ; dir = path.dirname(dir)) {
      if (dir.length < root.length) break;
      chosen = configIn(dir);
      if (chosen || dir === root) break;
    }
  }
  if (!chosen) return { configs: [], read: [] };
  const top = loadTsConfig(chosen, cache);
  if (!top) return { configs: [], read: [] };

  const nested = reachable(top, cache);
  const read = [top, ...nested];
  if (ancestor && ![top, ...nested].some((c) => covers(c, files))) return { configs: [], read: [] };
  if (!top.solution) return { configs: [top], read };
  const covering = nested.filter((c) => !c.solution && covers(c, files));
  return { configs: covering.length > 0 ? covering : [top], read };
}

/** The nearest `tsconfig.json`, else `jsconfig.json`, from `dir` up to the repository root. Absolute path. */
export function nearestTsConfig(repoPath: string, dir: string): string | undefined {
  const root = path.resolve(repoPath);
  for (let current = path.resolve(root, dir); current.length >= root.length; current = path.dirname(current)) {
    const found = configIn(current);
    if (found) return found;
    if (current === root) break;
  }
  return undefined;
}
