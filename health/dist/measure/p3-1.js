import { d3Gap, getD3Rules } from './d3/index.js';
export const p31 = {
    id: '3.1',
    layer: 'static',
    async measure(ctx) {
        const gap = d3Gap(ctx);
        if (gap !== undefined)
            return { status: 'not_measured', reason: gap };
        const { units, warnings } = await getD3Rules(ctx);
        return {
            status: 'measured',
            units: units.map((unit) => ({ package: unit.package, group: unit.group, weight: unit.weight, raw: { kind: 'level', level: unit.level31 } })),
            ...(warnings.length === 0 ? {} : { warnings: warnings.map((w) => `3.1: ${w}`) }),
        };
    },
};
