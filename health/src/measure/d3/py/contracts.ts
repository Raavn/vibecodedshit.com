import { moduleName, type PyRoot } from './roots.js';

export interface PresetRuleInput {
  name: string;
  from: { in?: string[]; not_in?: string[] };
  to: { in?: string[]; packages?: string[] };
  severity: 'error' | 'warn' | 'info';
  type_only_imports: 'included' | 'excluded';
}

/** An import-linter `forbidden` contract in the options shape the helper hands to import-linter (booleans are strings). */
export interface ForbiddenContract {
  id: string;
  name: string;
  type: 'forbidden';
  source_modules: string[];
  forbidden_modules: string[];
  as_packages: 'false';
  allow_indirect_imports: 'true';
  unmatched_ignore_imports_alerting: 'none';
}

export interface ContractMeta {
  rule: string;
  excludesTypeOnly: boolean;
}

/**
 * Preset rules as contracts for one unit. `layerFiles` maps a layer to the unit's files in it; `unitFiles` is every
 * in-scope file of the unit. One contract per (preset rule, `to` alternative), named `<package>:<rule>` with a
 * `#packages` suffix on the packages alternative. Only files in a root package have module names.
 */
export function presetContracts(
  packageDir: string,
  rules: PresetRuleInput[],
  layerFiles: Map<string, Set<string>>,
  unitFiles: string[],
  roots: PyRoot[],
): { contracts: ForbiddenContract[]; meta: Map<string, ContractMeta> } {
  const names = (files: Iterable<string>): string[] => {
    const out = new Set<string>();
    for (const file of files) {
      for (const root of roots) {
        const name = moduleName(root, file);
        if (name !== undefined) {
          out.add(name);
          break;
        }
      }
    }
    return [...out].sort();
  };
  const union = (layers: string[]): string[] => [...new Set(layers.flatMap((l) => [...(layerFiles.get(l) ?? [])]))];
  const contracts: ForbiddenContract[] = [];
  const meta = new Map<string, ContractMeta>();
  for (const rule of rules) {
    if (rule.severity === 'info') continue;
    let fromFiles: string[];
    if (rule.from.in) fromFiles = union(rule.from.in);
    else {
      const excluded = new Set(union(rule.from.not_in ?? []));
      fromFiles = unitFiles.filter((f) => !excluded.has(f));
    }
    const source = names(fromFiles);
    if (source.length === 0) continue;
    const base = `${packageDir}:${rule.name}`;
    const add = (name: string, forbidden: string[]): void => {
      if (forbidden.length === 0) return;
      contracts.push({
        id: name,
        name,
        type: 'forbidden',
        source_modules: source,
        forbidden_modules: forbidden,
        as_packages: 'false',
        allow_indirect_imports: 'true',
        unmatched_ignore_imports_alerting: 'none',
      });
      meta.set(name, { rule: rule.name, excludesTypeOnly: rule.type_only_imports === 'excluded' });
    };
    add(base, rule.to.in ? names(union(rule.to.in)) : []);
    add(`${base}#packages`, rule.to.packages ?? []);
  }
  return { contracts, meta };
}
