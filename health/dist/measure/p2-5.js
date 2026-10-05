import { measureFindings } from '../exec/findings.js';
export const p25 = {
    id: '2.5',
    layer: 'execution',
    async measure(ctx) {
        return measureFindings(ctx, (exec) => exec.lint);
    },
};
