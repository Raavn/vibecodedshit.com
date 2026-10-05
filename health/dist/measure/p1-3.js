import { measureCoverage } from '../exec/tests.js';
export const p13 = {
    id: '1.3',
    layer: 'execution',
    async measure(ctx) {
        return measureCoverage(ctx, 'branches');
    },
};
