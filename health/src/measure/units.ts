import type { Group, Scope, ScopedFile } from '../scope/types.js';

export interface UnitKey {
  package: string;
  group: Group;
}

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
