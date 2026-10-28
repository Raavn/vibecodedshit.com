import { d3Gap, getD3Graph } from './d3/index.js';
import { unavailable } from '../tools/outcome.js';
/** Cross-module imports that land on the module's public entry. Not applicable without two modules in a unit. */
export const p34 = {
    id: '3.4',
    layer: 'static',
    async measure(ctx) {
        const gap = d3Gap(ctx);
        if (gap !== undefined)
            return { status: 'not_measured', reason: gap };
        const graph = await getD3Graph(ctx);
        if ('unavailable' in graph)
            return unavailable(graph.unavailable);
        const units = graph.units
            .filter((unit) => unit.moduleCount >= 2)
            .map((unit) => ({
            package: unit.package,
            group: unit.group,
            weight: unit.weight,
            raw: { kind: 'ratio', numerator: unit.crossings.filter((c) => c.toEntry).length, denominator: unit.crossings.length, scale: 100 },
        }));
        if (units.length === 0)
            return { status: 'not_applicable', reason: ctx.param.not_applicable_when ?? 'fewer than two modules' };
        return { status: 'measured', units };
    },
};
