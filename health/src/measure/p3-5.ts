import { d3Gap, getD3Graph } from './d3/index.js';
import { unavailable } from '../tools/outcome.js';
import type { Measurer, UnitRaw } from './types.js';

/** Domain files that import infrastructure. Not applicable without a domain layer. */
export const p35: Measurer = {
  id: '3.5',
  layer: 'static',
  async measure(ctx) {
    const gap = d3Gap(ctx);
    if (gap !== undefined) return { status: 'not_measured', reason: gap };
    const graph = await getD3Graph(ctx);
    if ('unavailable' in graph) return unavailable(ctx, graph.unavailable);
    const units: UnitRaw[] = graph.units
      .filter((unit) => unit.domain.files.length > 0)
      .map((unit) => ({
        package: unit.package,
        group: unit.group,
        weight: unit.weight,
        raw: { kind: 'ratio', numerator: unit.domain.impure.length, denominator: unit.domain.files.length, scale: 100 },
      }));
    if (units.length === 0) return { status: 'not_applicable', reason: ctx.param.not_applicable_when ?? 'no domain layer' };
    return { status: 'measured', units };
  },
};
