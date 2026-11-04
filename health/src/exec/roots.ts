import { logicUnits, type LogicUnit } from '../measure/units.js';
import type { UnitRaw } from '../measure/types.js';
import type { ExecutionRoot } from '../run/schema.js';
import type { Group, Scope } from '../scope/types.js';
import { isUnder } from './plan.js';
import type { ExecutionResults, RootResult } from './types.js';

export function installFailed(root: RootResult): boolean {
  return root.install !== null && root.install.status !== 'ok';
}

/** False only when every install root failed to install. With no root at all the checks ran. */
export function anyRootHealthy(roots: RootResult[]): boolean {
  return roots.length === 0 || roots.some((root) => !installFailed(root));
}

/** The install root of `group` whose install failed and that holds `dir` (a directory or a file path), or undefined. Install roots of one group never nest, so it is unique. */
export function failedRootOf(exec: ExecutionResults, dir: string, group: Group): RootResult | undefined {
  return exec.roots.find((root) => installFailed(root) && root.group === group && isUnder(dir, root.dir));
}

/**
 * The failed install roots a unit depends on: those holding its package directory or any of its logic files.
 * A package is a workspace member or a directory with its own pyproject.toml, so without workspaces one TS/JS unit
 * can span several install roots; it then counts as failed as soon as one of them failed.
 */
function failedRootsOf(exec: ExecutionResults, unit: LogicUnit): RootResult[] {
  return exec.roots.filter((root) => installFailed(root) && root.group === unit.group && (isUnder(unit.dir, root.dir) || unit.files.some((f) => isUnder(f.path, root.dir))));
}

/** One failed unit per (package, group) that depends on a failed install root. */
export function failedUnits(exec: ExecutionResults, scope: Scope): UnitRaw[] {
  return logicUnits(scope)
    .filter((unit) => failedRootsOf(exec, unit).length > 0)
    .map((unit) => ({ package: unit.package, group: unit.group, weight: unit.weight, raw: { kind: 'failed' } }));
}

const unitKey = (unit: Pick<UnitRaw, 'package' | 'group'>): string => `${unit.package}\0${unit.group}`;

/** `units` with the units beneath a failed install root replaced by failed ones. Order is kept when no root failed. */
export function withFailedUnits(exec: ExecutionResults, scope: Scope, units: UnitRaw[]): UnitRaw[] {
  const failed = failedUnits(exec, scope);
  if (failed.length === 0) return units;
  const keys = new Set(failed.map(unitKey));
  return [...units.filter((unit) => !keys.has(unitKey(unit))), ...failed].sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group));
}

/** The failed install roots that the failed units of a measurement lie under, for the report. */
export function failedRootDirs(exec: ExecutionResults, scope: Scope, units: UnitRaw[]): string[] {
  const logic = new Map(logicUnits(scope).map((unit) => [unitKey(unit), unit]));
  const dirs = units.flatMap((unit) => {
    const found = logic.get(unitKey(unit));
    return unit.raw.kind === 'failed' && found ? failedRootsOf(exec, found).map((root) => root.dir) : [];
  });
  return [...new Set(dirs)].sort();
}

/** The install outcome of every install root, as run.json records it. */
export function executionRoots(exec: ExecutionResults): ExecutionRoot[] {
  return exec.roots.map((root) => ({ dir: root.dir, group: root.group, install: root.install?.status ?? null, exitCode: root.install?.exitCode ?? null }));
}
