import { loadMethodology } from '../../src/methodology/load.js';
import { measurers } from '../../src/measure/registry.js';
import type { Measurement } from '../../src/measure/types.js';
import { buildScope } from '../../src/scope/build.js';
import { fakeToolKit } from './tools.js';
import { materializeFixture } from './fixture.js';

export const methodology = loadMethodology('1.0');

/** Run one static measurer on a repository made of the given tracked files (and optional untracked extras). */
export async function measureFiles(id: string, files: Record<string, string>, extraFiles: Record<string, string> = {}): Promise<Measurement> {
  const repoPath = materializeFixture('blank', extraFiles, files);
  const scope = await buildScope(repoPath, methodology);
  const measurer = measurers.find((m) => m.id === id);
  const param = methodology.dimensions.flatMap((d) => d.parameters).find((p) => p.id === id);
  if (!measurer || !param) throw new Error(`no measurer ${id}`);
  return measurer.measure({ methodology, param, scope, repoPath, asOf: '2026-10-04', mode: 'preview', tools: fakeToolKit() });
}

export interface Simple {
  package: string;
  group: string;
  weight: number;
  raw: unknown;
}

export function unitsOf(m: Measurement): Simple[] {
  if (m.status !== 'measured') throw new Error(JSON.stringify(m));
  return m.units;
}

export function warningsOf(m: Measurement): string[] {
  return m.status === 'measured' ? (m.warnings ?? []) : [];
}
