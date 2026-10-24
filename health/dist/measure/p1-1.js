import { measurePassRate } from '../exec/tests.js';
export const p11 = {
    id: '1.1',
    layer: 'execution',
    async measure(ctx) {
        return measurePassRate(ctx);
    },
};
