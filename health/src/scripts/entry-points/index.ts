import type { EntryPointKind } from '../types.js';
import { justfileEntryPoints } from './justfile.js';
import { makefileEntryPoints } from './makefile.js';
import { noxEntryPoints } from './nox.js';
import { packageJsonEntryPoints } from './package-json.js';
import { pyprojectEntryPoints } from './pyproject.js';
import { toxEntryPoints } from './tox.js';

/** Explicit list. */
export const entryPointKinds: EntryPointKind[] = [
  packageJsonEntryPoints,
  makefileEntryPoints,
  justfileEntryPoints,
  toxEntryPoints,
  noxEntryPoints,
  pyprojectEntryPoints,
];

export function entryPointKind(id: string): EntryPointKind | undefined {
  return entryPointKinds.find((kind) => kind.id === id);
}
