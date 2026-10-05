import { measureCoverage } from '../exec/tests.js';
export const p12 = {
    id: '1.2',
    layer: 'execution',
    async measure(ctx) {
        return measureCoverage(ctx, 'lines');
    },
};
