import path from 'node:path';
import { readTracked } from '../scope/tracked.js';

export interface PackageJson {
  name?: string;
  scripts: Record<string, string>;
  /** dependencies, devDependencies, peerDependencies and optionalDependencies merged. */
  dependencies: Record<string, string>;
  engines: Record<string, string>;
  volta?: Record<string, unknown>;
  packageManager?: string;
  workspaces?: unknown;
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** The `package.json` in `dir` (repo-relative, "." for the root). Missing or invalid JSON gives undefined. */
export function readPackageJson(repoPath: string, dir: string): PackageJson | undefined {
  const text = readTracked(repoPath, path.posix.join(dir === '' ? '.' : dir, 'package.json'));
  if (text === null) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const bag = json as Record<string, unknown>;
  const dependencies: Record<string, string> = {};
  for (const field of DEPENDENCY_FIELDS) Object.assign(dependencies, stringRecord(bag[field]));
  return {
    ...(typeof bag.name === 'string' ? { name: bag.name } : {}),
    scripts: stringRecord(bag.scripts),
    dependencies,
    engines: stringRecord(bag.engines),
    ...(bag.volta !== null && typeof bag.volta === 'object' ? { volta: bag.volta as Record<string, unknown> } : {}),
    ...(typeof bag.packageManager === 'string' ? { packageManager: bag.packageManager } : {}),
    ...(bag.workspaces === undefined ? {} : { workspaces: bag.workspaces }),
  };
}
