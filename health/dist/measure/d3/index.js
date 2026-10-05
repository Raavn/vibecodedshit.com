import { pyAdapter } from './py/adapter.js';
import { tsAdapter } from './ts/adapter.js';
/** Explicit list. */
export const D3_ADAPTERS = [tsAdapter, pyAdapter];
function adaptersFor(ctx) {
    const groups = new Set(ctx.scope.files.filter((f) => f.role === 'logic').map((f) => f.group));
    return D3_ADAPTERS.filter((adapter) => groups.has(adapter.group));
}
/**
 * Why D3 cannot be measured as a whole: a language group has logic files but no adapter yet.
 * Partial pooling would score only the languages that have one.
 */
export function d3Gap(ctx) {
    const covered = new Set(D3_ADAPTERS.map((adapter) => adapter.group));
    const missing = [...new Set(ctx.scope.files.filter((f) => f.role === 'logic').map((f) => f.group))].filter((g) => !covered.has(g));
    return missing.length === 0 ? undefined : `D3 is not implemented yet for ${missing.join(', ')}`;
}
/** The rules facet: needs no external tool. Memoized per scan. */
export function getD3Rules(ctx) {
    return ctx.tools.memo(`d3:rules:${ctx.repoPath}`, async () => {
        const units = [];
        const warnings = [];
        for (const adapter of adaptersFor(ctx)) {
            const result = await adapter.rules(ctx);
            units.push(...result.units);
            warnings.push(...result.warnings);
        }
        return { units, warnings };
    });
}
/** The graph facet. When any needed adapter is unavailable, the whole facet is (no partial pool). Memoized per scan. */
export function getD3Graph(ctx) {
    return ctx.tools.memo(`d3:graph:${ctx.repoPath}`, async () => {
        const units = [];
        const warnings = [];
        for (const adapter of adaptersFor(ctx)) {
            const result = await adapter.graph(ctx);
            if ('unavailable' in result)
                return result;
            units.push(...result.units);
            warnings.push(...result.warnings);
        }
        return { units, warnings };
    });
}
