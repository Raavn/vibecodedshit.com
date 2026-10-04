import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getD3Graph, getD3Rules } from '../../src/measure/d3/index.js';
import { cyclicNodes } from '../../src/measure/d3/scc.js';
import { edgeKey, type D3Graph, type D3GraphResult, type D3Rules } from '../../src/measure/d3/types.js';
import { measurers } from '../../src/measure/registry.js';
import type { Measurement, MeasureContext } from '../../src/measure/types.js';
import { loadMethodology } from '../../src/methodology/load.js';
import { buildScope } from '../../src/scope/build.js';
import { fixturesDir, materializeFixture } from './fixture.js';
import { fakeToolKit, type FakeKit } from './tools.js';

export const methodology = loadMethodology('1.0');

export async function d3Context(
  repoPath: string,
  tools: FakeKit = fakeToolKit(),
  mode: 'preview' | 'full' = 'preview',
): Promise<(id: string) => MeasureContext> {
  const scope = await buildScope(repoPath, methodology);
  return (id) => {
    const param = methodology.dimensions.flatMap((d) => d.parameters).find((p) => p.id === id);
    if (!param) throw new Error(`no parameter ${id}`);
    return { methodology, param, scope, repoPath, asOf: '2026-10-04', mode, tools };
  };
}

export async function fixtureContext(name: string, extra: Record<string, string> = {}, tracked: Record<string, string> = {}) {
  const repoPath = materializeFixture(name, extra, tracked);
  return { repoPath, ctx: await d3Context(repoPath) };
}

export function measure(ctx: (id: string) => MeasureContext, id: string): Promise<Measurement> {
  const measurer = measurers.find((m) => m.id === id);
  if (!measurer) throw new Error(`no measurer ${id}`);
  return measurer.measure(ctx(id));
}

export function expected(name: string): Record<string, never> {
  return JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Record<string, never>;
}

export async function graphOf(ctx: (id: string) => MeasureContext): Promise<{ units: D3Graph[]; warnings: string[] }> {
  const result: D3GraphResult = await getD3Graph(ctx('3.2'));
  if ('unavailable' in result) throw new Error(result.unavailable);
  return result;
}

export async function rulesOf(ctx: (id: string) => MeasureContext): Promise<{ units: D3Rules[]; warnings: string[] }> {
  return getD3Rules(ctx('3.1'));
}

/** "<from> -> <to> (<rule>)" per violating edge, the shape of expected.json. */
export function violations(unit: D3Graph): string[] {
  return unit.violating.map((key) => {
    const [from, to] = key.split('\u0000');
    return `${from} -> ${to} (${(unit.violationRules[key] ?? []).join(',')})`;
  });
}

export function cyclicFiles(units: D3Graph[], pkg: string): string[] {
  const nodes = units.flatMap((u) => u.logicFiles);
  const edges = units.flatMap((u) => u.edges.filter((e) => e.runtime && !e.fromTest).map((e): [string, string] => [e.from, e.to]));
  const cyclic = cyclicNodes(nodes, edges);
  return (units.find((u) => u.package === pkg)?.logicFiles ?? []).filter((f) => cyclic.has(f)).sort();
}

export { edgeKey };
