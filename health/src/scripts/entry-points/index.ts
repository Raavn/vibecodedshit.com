import type { EntryPointKind } from '../types.js';
import { makefileEntryPoints } from './makefile.js';
import { packageJsonEntryPoints } from './package-json.js';

/** Explicit list. Justfile, tox, nox and pyproject kinds are added by the operability tasks. */
export const entryPointKinds: EntryPointKind[] = [packageJsonEntryPoints, makefileEntryPoints];

export function entryPointKind(id: string): EntryPointKind | undefined {
  return entryPointKinds.find((kind) => kind.id === id);
}
