import { normalizeName } from '../util/pep440.js';
import { unavailable } from '../tools/outcome.js';
import { resolveDirect, unitDeps } from './deps/resolved.js';
import { CONCURRENCY, fetchRegistry, majorsBehind, RegistryError, type DirectDependency, type RegistryData } from './deps/registry.js';
import { scopeUnits } from './deps/units.js';
import type { Group } from '../scope/types.js';
import type { Measurer, UnitRaw } from './types.js';

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(workers);
}

export const p52: Measurer = {
  id: '5.2',
  layer: 'static',
  async measure(ctx) {
    const warnings: string[] = [];
    const checked: DirectDependency[] = [];
    for (const unit of scopeUnits(ctx)) {
      const deps = await unitDeps(ctx, unit.package, unit.group);
      if (deps.lockfiles.length === 0) {
        warnings.push(`5.2: ${unit.package} has no lockfile, dependencies not checked`);
        continue;
      }
      const seen = new Set<string>();
      for (const dep of resolveDirect(deps)) {
        if (!dep.registry || dep.version === undefined) continue;
        const key = unit.group === 'python' ? normalizeName(dep.name) : dep.name;
        if (seen.has(key)) continue;
        seen.add(key);
        checked.push({ package: unit.package, group: unit.group, name: dep.name, version: dep.version, dev: dep.dev });
      }
    }

    const wanted = new Map<string, { group: Group; name: string }>();
    for (const dep of checked) wanted.set(`${dep.group}:${dep.group === 'python' ? normalizeName(dep.name) : dep.name}`, { group: dep.group, name: dep.name });
    const registryData = new Map<string, RegistryData | null>();
    try {
      await inBatches([...wanted], CONCURRENCY, async ([key, { group, name }]) => {
        registryData.set(key, await fetchRegistry(ctx, group, name));
      });
    } catch (err) {
      if (err instanceof RegistryError) return unavailable(ctx, err.message);
      throw err;
    }
    for (const [key, data] of [...registryData].sort(([a], [b]) => a.localeCompare(b))) {
      if (data === null) warnings.push(`5.2: ${key.slice(key.indexOf(':') + 1)} not found on the registry`);
    }

    const units: UnitRaw[] = scopeUnits(ctx).map((unit) => {
      const own = checked.filter((d) => d.package === unit.package && d.group === unit.group);
      const { numerator, denominator } = majorsBehind(own, registryData, ctx.asOf);
      return {
        package: unit.package,
        group: unit.group,
        weight: unit.weight,
        raw: { kind: 'ratio', numerator, denominator, scale: 100 },
      };
    });
    return {
      status: 'measured',
      units,
      warnings,
      reportOnly: {
        directDependencies: checked
          .filter((d) => registryData.get(`${d.group}:${d.group === 'python' ? normalizeName(d.name) : d.name}`) !== null)
          .map((d) => ({ package: d.package, group: d.group, name: d.name, version: d.version, dev: d.dev })),
      },
    };
  },
};
