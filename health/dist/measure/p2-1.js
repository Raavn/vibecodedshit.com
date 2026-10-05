import { measureFindings } from '../exec/findings.js';
export const p21 = {
    id: '2.1',
    layer: 'execution',
    async measure(ctx) {
        return measureFindings(ctx, (exec) => exec.typecheck);
    },
};
