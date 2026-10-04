import { unitDeps, lockLevel } from './deps/resolved.js';
import { scopeUnits } from './deps/units.js';
import type { Measurer, UnitRaw } from './types.js';

export const p53: Measurer = {
  id: '5.3',
  layer: 'static',
  async measure(ctx) {
    const units: UnitRaw[] = [];
    const warnings: string[] = [];
    for (const unit of scopeUnits(ctx)) {
      const deps = await unitDeps(ctx, unit.package, unit.group);
      warnings.push(...(deps.manifest?.warnings ?? []));
      units.push({
        package: unit.package,
        group: unit.group,
        weight: unit.weight,
        raw: { kind: 'level', level: lockLevel(deps) },
      });
    }
    return { status: 'measured', units, warnings };
  },
};
