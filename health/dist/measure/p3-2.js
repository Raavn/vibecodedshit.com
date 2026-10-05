import { d3Gap, getD3Graph } from './d3/index.js';
import { internalEdges } from './d3/types.js';
import { unavailable } from '../tools/outcome.js';
/** Violations per 1,000 internal import edges. */
export const p32 = {
    id: '3.2',
    layer: 'static',
    async measure(ctx) {
        const gap = d3Gap(ctx);
        if (gap !== undefined)
            return { status: 'not_measured', reason: gap };
        const graph = await getD3Graph(ctx);
        if ('unavailable' in graph)
            return unavailable(ctx, graph.unavailable);
        return {
            status: 'measured',
            units: graph.units.map((unit) => ({
                package: unit.package,
                group: unit.group,
                weight: unit.weight,
                raw: { kind: 'ratio', numerator: unit.violating.length, denominator: internalEdges(unit).length, scale: 1000 },
            })),
            ...(graph.warnings.length === 0 ? {} : { warnings: graph.warnings.map((w) => `3.2: ${w}`) }),
        };
    },
};
