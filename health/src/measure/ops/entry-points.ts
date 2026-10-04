import path from 'node:path';
import type { D6Lists } from '../../methodology/load.js';
import { checkKinds, UNRECOGNISED_RUNNERS, type CheckKind } from '../../scripts/checks.js';
import { entryPointKinds } from '../../scripts/entry-points/index.js';
import { expandCommand } from '../../scripts/expand.js';

/** The directory itself and each ancestor up to the repository root ("."). */
export function dirsUpward(dir: string): string[] {
  const out: string[] = [];
  for (let current = path.posix.normalize(dir === '' ? '.' : dir); ; current = path.posix.dirname(current)) {
    out.push(current);
    if (current === '.' || current === '' || current.startsWith('..')) return out;
  }
}

export interface EntryPointResult {
  name: string;
  kinds: Set<CheckKind>;
  unrecognised: string[];
}

/** Entry points defined in exactly `dir`, expanded up to 3 levels, with the checks each one runs. Memoized per scan. */
export class EntryPointChecks {
  private readonly cache = new Map<string, EntryPointResult[]>();

  constructor(
    private readonly repoPath: string,
    private readonly rec: D6Lists,
  ) {}

  inDir(dir: string): EntryPointResult[] {
    const cached = this.cache.get(dir);
    if (cached) return cached;
    const results: EntryPointResult[] = [];
    for (const kind of entryPointKinds) {
      for (const entry of kind.list(this.repoPath, dir)) {
        const commands = expandCommand(this.repoPath, entry.invoke, { dir, file: dir }, { maxDepth: 3 });
        const kinds = new Set<CheckKind>();
        const unrecognised = new Set<string>();
        for (const command of commands) {
          for (const found of checkKinds(command, this.rec)) kinds.add(found);
          if (command.tool !== null && UNRECOGNISED_RUNNERS.has(command.tool)) unrecognised.add(command.tool);
        }
        results.push({ name: `${path.posix.join(dir, kind.id)}:${entry.name}`, kinds, unrecognised: [...unrecognised] });
      }
    }
    this.cache.set(dir, results);
    return results;
  }

  /** Candidate entry points for a unit: those of its package directory and of every ancestor (a root `verify` covers every package). */
  forUnit(dir: string): EntryPointResult[] {
    return dirsUpward(dir).flatMap((d) => this.inDir(d));
  }
}
