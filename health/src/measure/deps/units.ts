import { emptyTallies, logicFiles, type Tally } from '../units.js';
import type { MeasureContext } from '../types.js';

/** Scope units: every (package, language group) with logic files, weight = its logic lines. */
export function scopeUnits(ctx: MeasureContext): Tally[] {
  return [...emptyTallies([...logicFiles(ctx.scope, 'typescript_javascript'), ...logicFiles(ctx.scope, 'python')]).values()].sort(
    (a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group),
  );
}
