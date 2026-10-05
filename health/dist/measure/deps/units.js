import { emptyTallies, logicFiles } from '../units.js';
/** Scope units: every (package, language group) with logic files, weight = its logic lines. */
export function scopeUnits(ctx) {
    return [...emptyTallies([...logicFiles(ctx.scope, 'typescript_javascript'), ...logicFiles(ctx.scope, 'python')]).values()].sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group));
}
