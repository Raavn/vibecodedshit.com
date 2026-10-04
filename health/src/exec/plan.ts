import path from 'node:path';
import type { Group, Scope, ScopedFile } from '../scope/types.js';

const MANIFEST: Record<Group, (base: string) => boolean> = {
  typescript_javascript: (base) => base === 'package.json',
  python: (base) => base === 'pyproject.toml' || base === 'Pipfile' || base === 'setup.py' || /^requirements.*\.txt$/.test(base),
};

export interface PlannedRoot {
  dir: string;
  group: Group;
  /** Logic lines of the group beneath the root. */
  weight: number;
  /** Logic files beneath the root, for the build step. */
  logicFiles: string[];
  /** Logic and test files beneath the root, for lint. */
  sourceFiles: string[];
}

export interface PlannedTypecheck {
  /** Workspace package directory, the step's working directory. */
  dir: string;
  group: Group;
  /** The install root the package belongs to. */
  root: string;
  sourceFiles: string[];
}

export interface ExecutionPlan {
  roots: PlannedRoot[];
  typecheck: PlannedTypecheck[];
}

function isUnder(dir: string, parent: string): boolean {
  return parent === '.' || dir === parent || dir.startsWith(`${parent}/`);
}

/**
 * Install roots per language group: the manifest directories that have no manifest directory of the
 * same group above them, so a workspace installs once at its root and a nested example does not
 * need an install of its own. Logic files outside every root go to a root at "." with nothing to install.
 * A root with no logic file of its group beneath it is dropped.
 */
export function planExecution(scope: Scope, tracked: string[]): ExecutionPlan {
  const roots: PlannedRoot[] = [];
  const typecheck: PlannedTypecheck[] = [];
  for (const group of ['typescript_javascript', 'python'] as const) {
    const files = scope.files.filter((f) => f.group === group && (f.role === 'logic' || f.role === 'test'));
    if (!files.some((f) => f.role === 'logic')) continue;

    const manifestDirs = [...new Set(tracked.filter((file) => MANIFEST[group](path.posix.basename(file))).map((file) => path.posix.dirname(file)))];
    const candidates = manifestDirs.filter((dir) => !manifestDirs.some((other) => other !== dir && isUnder(dir, other))).sort();
    const rootOf = (file: ScopedFile): string => candidates.find((dir) => isUnder(path.posix.dirname(file.path), dir)) ?? '.';

    const byRoot = new Map<string, ScopedFile[]>();
    for (const file of files) byRoot.set(rootOf(file), [...(byRoot.get(rootOf(file)) ?? []), file]);
    for (const [dir, groupFiles] of [...byRoot].sort(([a], [b]) => a.localeCompare(b))) {
      const logic = groupFiles.filter((f) => f.role === 'logic');
      if (logic.length === 0) continue;
      roots.push({
        dir,
        group,
        weight: logic.reduce((sum, f) => sum + f.logicLines, 0),
        logicFiles: logic.map((f) => f.path),
        sourceFiles: groupFiles.map((f) => f.path),
      });
    }

    const byPackage = new Map<string, ScopedFile[]>();
    for (const file of files) byPackage.set(file.package, [...(byPackage.get(file.package) ?? []), file]);
    for (const [dir, unitFiles] of [...byPackage].sort(([a], [b]) => a.localeCompare(b))) {
      if (!unitFiles.some((f) => f.role === 'logic')) continue;
      typecheck.push({ dir, group, root: rootOf(unitFiles[0] as ScopedFile), sourceFiles: unitFiles.map((f) => f.path) });
    }
  }
  return { roots, typecheck };
}
