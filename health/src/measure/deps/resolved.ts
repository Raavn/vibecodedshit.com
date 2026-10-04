import path from 'node:path';
import semver from 'semver';
import type { Group } from '../../scope/types.js';
import { compareVersions, parseVersion, satisfies as pySatisfies } from '../../util/pep440.js';
import type { MeasureContext } from '../types.js';
import { readManifest, type DeclaredDep, type Manifest } from './declared.js';
import { entrySatisfies, findLockfiles, readLockfile, type LockfileRef, type LockReader } from './lockfiles.js';

export interface UnitDeps {
  package: string;
  group: Group;
  manifest: Manifest | undefined;
  /** Candidate lockfiles with their parsed content (undefined = unreadable). */
  lockfiles: { ref: LockfileRef; reader: LockReader | undefined }[];
}

export interface ResolvedDep {
  name: string;
  /** Undefined when the lockfile does not hold the dependency. */
  version: string | undefined;
  dev: boolean;
  registry: boolean;
}

/** Manifest and lockfiles of one unit, read once per scan. */
export function unitDeps(ctx: MeasureContext, pkg: string, group: Group): Promise<UnitDeps> {
  return ctx.tools.memo(`deps:${pkg}\0${group}`, async () => {
    const manifest = readManifest(ctx.repoPath, pkg, group);
    const refs = manifest ? findLockfiles(ctx.repoPath, pkg, group) : [];
    const lockfiles = refs.map((ref) => ({ ref, reader: readLockfile(ctx.repoPath, ref) }));
    return { package: pkg, group, manifest, lockfiles };
  });
}

/** The unit's package directory relative to a lockfile's directory ('' when they are the same). */
export function relToLock(pkg: string, lockDir: string): string {
  const dir = pkg === '.' ? '' : pkg;
  if (lockDir === '') return dir;
  return dir === lockDir ? '' : path.posix.relative(lockDir, dir);
}

export type LockLevel = 'none' | 'out_of_sync' | 'in_sync';

export function lockLevel(unit: UnitDeps): LockLevel {
  if (!unit.manifest || unit.lockfiles.length === 0) return 'none';
  const inSync = unit.lockfiles.some(({ ref, reader }) => {
    if (!reader) return false;
    const rel = relToLock(unit.package, ref.dir);
    return (unit.manifest?.deps ?? []).every((dep) => entrySatisfies(dep, reader.lookup(dep, rel), unit.group));
  });
  return inSync ? 'in_sync' : 'out_of_sync';
}

function best(versions: string[], dep: DeclaredDep, group: Group): string | undefined {
  const fits = versions.filter((v) =>
    group === 'python' ? pySatisfies(v, dep.spec) : semver.satisfies(v, dep.spec, { includePrerelease: true }),
  );
  const pool = fits.length > 0 ? fits : versions;
  if (group === 'python') {
    return [...pool].sort((a, b) => {
      const pa = parseVersion(a);
      const pb = parseVersion(b);
      return pa && pb ? compareVersions(pb, pa) : 0;
    })[0];
  }
  return pool[0];
}

/** Declared direct dependencies with the version the first lockfile holding them resolves. */
export function resolveDirect(unit: UnitDeps): ResolvedDep[] {
  return (unit.manifest?.deps ?? []).map((dep) => {
    for (const { ref, reader } of unit.lockfiles) {
      if (!reader) continue;
      const entry = reader.lookup(dep, relToLock(unit.package, ref.dir));
      if (entry.present) return { name: dep.name, version: best(entry.versions, dep, unit.group), dev: dep.dev, registry: dep.registry };
    }
    return { name: dep.name, version: undefined, dev: dep.dev, registry: dep.registry };
  });
}
