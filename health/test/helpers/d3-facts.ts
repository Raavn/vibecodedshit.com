import type { D3Graph, D3Rules } from '../../src/measure/d3/types.js';
import type { MeasureContext } from '../../src/measure/types.js';
import { d3Context, methodology } from './d3.js';
import { materializeFixture } from './fixture.js';

export function rules(over: Partial<D3Rules> = {}): D3Rules {
  return { package: '.', group: 'typescript_javascript', weight: 100, preset: 'generic', rulesSource: 'preset', level31: 'none', ...over };
}

export function graph(over: Partial<D3Graph> = {}): D3Graph {
  return {
    ...rules(),
    logicFiles: [],
    edges: [],
    violating: [],
    violationRules: {},
    moduleCount: 0,
    crossings: [],
    domain: { files: [], impure: [] },
    ...over,
  };
}

/** A context whose D3 facets are the given synthetic facts, whatever the repository holds. */
export async function seededContext(facts: { rules?: D3Rules[]; graphs?: D3Graph[]; unavailable?: string }): Promise<(id: string) => MeasureContext> {
  const repoPath = materializeFixture('d3-na-ts');
  const ctx = await d3Context(repoPath);
  const any = ctx('3.1');
  await any.tools.memo(`d3:rules:${repoPath}`, async () => ({ units: facts.rules ?? facts.graphs ?? [], warnings: [] }));
  await any.tools.memo(`d3:graph:${repoPath}`, async () =>
    facts.unavailable === undefined ? { units: facts.graphs ?? [], warnings: [] } : { unavailable: facts.unavailable },
  );
  return ctx;
}

export { methodology };
