import path from 'node:path';
import semver from 'semver';
import type { Group } from '../../scope/types.js';
import { compareVersions, parseVersion, satisfies as pySatisfies } from '../../util/pep440.js';
import type { MeasureContext } from '../types.js';
import { readManifest, type DeclaredDep, type Manifest } from './declared.js';
import { trackedIn } from './files.js';
import { chooseJsLockfile, entrySatisfies, findLockfiles, jsLockfiles, readLockfile, type LockfileRef, type LockReader } from './lockfiles.js';

export interface UnitDeps {
  package: string;
  group: Group;
  manifest: Manifest | undefined;
  /** Candidate lockfiles with their parsed content (undefined = unreadable). */
  lockfiles: { ref: LockfileRef; reader: LockReader | undefined }[];
  /** Appended to run.json `warnings` by 5.3. */
  warnings: string[];
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
    const found = manifest ? findLockfiles(ctx.repoPath, pkg, group) : [];
    const { refs, warnings } = group === 'typescript_javascript' ? installedLockfile(ctx.repoPath, found) : { refs: found, warnings: [] };
    const lockfiles = refs.map((ref) => ({ ref, reader: readLockfile(ctx.repoPath, ref) }));
    return { package: pkg, group, manifest, lockfiles, warnings };
  });
}

/**
 * With several JS lockfiles in the lockfile directory, keep only the one the install step uses
 * (`chooseJsLockfile`) and warn. A binary `bun.lockb` cannot be read, so then every readable candidate stays.
 */
function installedLockfile(repoPath: string, refs: LockfileRef[]): { refs: LockfileRef[]; warnings: string[] } {
  const dir = refs[0]?.dir;
  if (dir === undefined) return { refs, warnings: [] };
  const names = jsLockfiles(trackedIn(repoPath, dir).map((file) => path.posix.basename(file)));
  if (names.length < 2) return { refs, warnings: [] };
  const chosen = chooseJsLockfile(names);
  const where = dir === '' ? 'the repository root' : dir;
  const picked = refs.filter((ref) => path.posix.basename(ref.path) === chosen);
  if (picked.length === 0) {
    return { refs, warnings: [`5.3: ${where} has several JS lockfiles (${names.join(', ')}); install uses ${chosen}, which is binary, so 5.3 checks ${refs.map((r) => path.posix.basename(r.path)).join(', ')}`] };
  }
  return { refs: picked, warnings: [`5.3: ${where} has several JS lockfiles (${names.join(', ')}); install and 5.3 use ${chosen}`] };
}

/** The unit's package directory relative to a lockfile's directory ('' when they are the same). */
function relToLock(pkg: string, lockDir: string): string {
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
