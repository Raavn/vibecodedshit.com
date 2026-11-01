import type { Group, Scope, ScopedFile } from '../scope/types.js';

export function logicFiles(scope: Scope, group: Group): ScopedFile[] {
  return scope.files.filter((f) => f.role === 'logic' && f.group === group);
}

export function unitId(file: Pick<ScopedFile, 'package' | 'group'>): string {
  return `${file.package}\0${file.group}`;
}

export interface Tally {
  package: string;
  group: Group;
  weight: number;
  numerator: number;
  denominator: number;
}

/** One tally per (package, group) that has logic files, weight = logic lines of the unit. */
export function emptyTallies(files: ScopedFile[]): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const file of files) {
    const key = unitId(file);
    const tally = tallies.get(key) ?? { package: file.package, group: file.group, weight: 0, numerator: 0, denominator: 0 };
    tally.weight += file.logicLines;
    tallies.set(key, tally);
  }
  return tallies;
}

export function tallyUnits(tallies: Map<string, Tally>) {
  return [...tallies.values()]
    .sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group))
    .map((t) => ({
      package: t.package,
      group: t.group,
      weight: t.weight,
      raw: { kind: 'ratio' as const, numerator: t.numerator, denominator: t.denominator, scale: 100 },
    }));
}

export interface LogicUnit {
  package: string;
  group: Group;
  /** The package directory, "." for the root. */
  dir: string;
  /** Logic lines of the unit. */
  weight: number;
  files: ScopedFile[];
}

/** One unit per (workspace package, language group) that has at least one logic-role file, sorted by package then group. */
export function logicUnits(scope: Scope): LogicUnit[] {
  const units = new Map<string, LogicUnit>();
  for (const file of scope.files) {
    if (file.role !== 'logic') continue;
    const key = unitId(file);
    const unit = units.get(key) ?? { package: file.package, group: file.group, dir: file.package, weight: 0, files: [] };
    unit.weight += file.logicLines;
    unit.files.push(file);
    units.set(key, unit);
  }
  return [...units.values()].sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group));
}
