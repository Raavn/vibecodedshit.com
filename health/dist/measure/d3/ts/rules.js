const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function emit(node) {
    const alternatives = [];
    for (const [segment, child] of node.children) {
        const rest = child.children.size > 0 ? `(?:/${emit(child)})${child.end ? '?' : ''}` : '';
        alternatives.push(`${escape(segment)}${rest}`);
    }
    return alternatives.length === 1 ? alternatives[0] : `(?:${alternatives.join('|')})`;
}
/** An anchored regex that matches exactly the given repo-relative paths, built from a segment trie. */
export function pathsToRegex(paths) {
    const root = { children: new Map(), end: false };
    for (const file of paths) {
        let node = root;
        for (const segment of file.split('/')) {
            let child = node.children.get(segment);
            if (!child) {
                child = { children: new Map(), end: false };
                node.children.set(segment, child);
            }
            node = child;
        }
        node.end = true;
    }
    return `^${emit(root)}$`;
}
/** Package names as a regex that also matches an import below the package (`pkg/sub`). */
export function packagesToRegex(packages) {
    return `^(?:${packages.map(escape).join('|')})(?:/|$)`;
}
/**
 * Preset rules as dependency-cruiser rules for one unit. `layerFiles` maps a layer name to the
 * unit's files in it; `unitFiles` is every in-scope file of the unit. One rule per (preset rule,
 * `to` alternative), named `<package>:<rule>` with a `#packages` suffix on the packages alternative.
 */
export function presetRules(packageDir, rules, layerFiles, unitFiles) {
    const out = [];
    const meta = new Map();
    const union = (names) => [...new Set(names.flatMap((n) => [...(layerFiles.get(n) ?? [])]))];
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
        if (fromFiles.length === 0)
            continue;
        const from = { path: pathsToRegex(fromFiles) };
        const base = `${packageDir}:${rule.name}`;
        const toFiles = rule.to.in ? union(rule.to.in) : [];
        const add = (name, to) => {
            out.push({ name, severity: rule.severity, from, to });
            meta.set(name, { rule: rule.name, excludesTypeOnly: rule.type_only_imports === 'excluded' });
        };
        if (toFiles.length > 0)
            add(base, { path: pathsToRegex(toFiles) });
        if (rule.to.packages && rule.to.packages.length > 0)
            add(`${base}#packages`, { path: packagesToRegex(rule.to.packages) });
    }
    return { rules: out, meta };
}
