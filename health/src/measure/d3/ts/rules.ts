
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Node {
  children: Map<string, Node>;
  end: boolean;
}

function emit(node: Node): string {
  const alternatives: string[] = [];
  for (const [segment, child] of node.children) {
    const rest = child.children.size > 0 ? `(?:/${emit(child)})${child.end ? '?' : ''}` : '';
    alternatives.push(`${escape(segment)}${rest}`);
  }
  return alternatives.length === 1 ? (alternatives[0] as string) : `(?:${alternatives.join('|')})`;
}

/** An anchored regex that matches exactly the given repo-relative paths, built from a segment trie. */
export function pathsToRegex(paths: string[]): string {
  const root: Node = { children: new Map(), end: false };
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
export function packagesToRegex(packages: string[]): string {
  return `^(?:${packages.map(escape).join('|')})(?:/|$)`;
}

export interface DcRule {
  name: string;
  severity: 'error' | 'warn';
  from: { path?: string | string[]; pathNot?: string | string[] };
  to: { path?: string | string[]; pathNot?: string | string[] };
}

export interface PresetRuleMeta {
  rule: string;
  excludesTypeOnly: boolean;
}

export interface PresetRuleInput {
  name: string;
  from: { in?: string[]; not_in?: string[] };
  to: { in?: string[]; packages?: string[] };
  severity: 'error' | 'warn' | 'info';
  type_only_imports: 'included' | 'excluded';
}

/**
 * Preset rules as dependency-cruiser rules for one unit. `layerFiles` maps a layer name to the
 * unit's files in it; `unitFiles` is every in-scope file of the unit. One rule per (preset rule,
 * `to` alternative), named `<package>:<rule>` with a `#packages` suffix on the packages alternative.
 */
export function presetRules(
  packageDir: string,
  rules: PresetRuleInput[],
  layerFiles: Map<string, Set<string>>,
  unitFiles: string[],
): { rules: DcRule[]; meta: Map<string, PresetRuleMeta> } {
  const out: DcRule[] = [];
  const meta = new Map<string, PresetRuleMeta>();
  const union = (names: string[]): string[] => [...new Set(names.flatMap((n) => [...(layerFiles.get(n) ?? [])]))];
  for (const rule of rules) {
    if (rule.severity === 'info') continue;
    let fromFiles: string[];
    if (rule.from.in) fromFiles = union(rule.from.in);
    else {
      const excluded = new Set(union(rule.from.not_in ?? []));
      fromFiles = unitFiles.filter((f) => !excluded.has(f));
    }
    if (fromFiles.length === 0) continue;
    const from = { path: pathsToRegex(fromFiles) };
    const base = `${packageDir}:${rule.name}`;
    const toFiles = rule.to.in ? union(rule.to.in) : [];
    const add = (name: string, to: DcRule['to']): void => {
      out.push({ name, severity: rule.severity as 'error' | 'warn', from, to });
      meta.set(name, { rule: rule.name, excludesTypeOnly: rule.type_only_imports === 'excluded' });
    };
    if (toFiles.length > 0) add(base, { path: pathsToRegex(toFiles) });
    if (rule.to.packages && rule.to.packages.length > 0) add(`${base}#packages`, { path: packagesToRegex(rule.to.packages) });
  }
  return { rules: out, meta };
}
