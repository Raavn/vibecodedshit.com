import { d3Gap, getD3Graph } from './d3/index.js';
import { cyclicNodes } from './d3/scc.js';
import { unavailable } from '../tools/outcome.js';
import type { Group } from '../scope/types.js';
import type { Measurer } from './types.js';

/** Logic files in a strongly connected component of two or more files of the runtime import graph, per language group. */
export const p33: Measurer = {
  id: '3.3',
  layer: 'static',
  async measure(ctx) {
    const gap = d3Gap(ctx);
    if (gap !== undefined) return { status: 'not_measured', reason: gap };
    const graph = await getD3Graph(ctx);
    if ('unavailable' in graph) return unavailable(graph.unavailable);
    const cyclic = new Map<Group, Set<string>>();
    for (const group of new Set(graph.units.map((u) => u.group))) {
      const members = graph.units.filter((u) => u.group === group);
      const nodes = members.flatMap((u) => u.logicFiles);
      const edges = members.flatMap((u) => u.edges.filter((e) => e.runtime && !e.fromTest).map((e): [string, string] => [e.from, e.to]));
      cyclic.set(group, cyclicNodes(nodes, edges));
    }
    return {
      status: 'measured',
      units: graph.units.map((unit) => ({
        package: unit.package,
        group: unit.group,
        weight: unit.weight,
        raw: {
          kind: 'ratio',
          numerator: unit.logicFiles.filter((f) => cyclic.get(unit.group)?.has(f)).length,
          denominator: unit.logicFiles.length,
          scale: 100,
        },
      })),
    };
  },
};
