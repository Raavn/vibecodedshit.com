import { moduleName } from './roots.js';
/**
 * Preset rules as contracts for one unit. `layerFiles` maps a layer to the unit's files in it; `unitFiles` is every
 * in-scope file of the unit. One contract per (preset rule, `to` alternative), named `<package>:<rule>` with a
 * `#packages` suffix on the packages alternative. Only files in a root package have module names.
 */
export function presetContracts(packageDir, rules, layerFiles, unitFiles, roots) {
    const names = (files) => {
        const out = new Set();
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
    const union = (layers) => [...new Set(layers.flatMap((l) => [...(layerFiles.get(l) ?? [])]))];
    const contracts = [];
    const meta = new Map();
    for (const rule of rules) {
        if (rule.severity === 'info')
            continue;
        let fromFiles;
        if (rule.from.in)
            fromFiles = union(rule.from.in);
        else {
            const excluded = new Set(union(rule.from.not_in ?? []));
            fromFiles = unitFiles.filter((f) => !excluded.has(f));
        }
        const source = names(fromFiles);
        if (source.length === 0)
            continue;
        const base = `${packageDir}:${rule.name}`;
        const add = (name, forbidden) => {
            if (forbidden.length === 0)
                return;
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
