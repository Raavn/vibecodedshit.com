import { findFile, joinContinuations } from './find.js';
import type { EntryPointKind } from '../types.js';

const JUSTFILES = ['justfile', 'Justfile', '.justfile'];

interface Recipe {
  dependencies: string[];
  body: string[];
}

/** Line based: `name [params...]: [dependencies]`, indented lines are the body. `alias`, `set`, `import`, `mod`, assignments and attributes are ignored. */
function parseJustfile(text: string): Map<string, Recipe> {
  const recipes = new Map<string, Recipe>();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let current: Recipe | undefined;
  let shebang = false;
  for (const line of lines) {
    if (/^[ \t]+\S/.test(line)) {
      if (!current) continue;
      const trimmed = line.trim();
      if (current.body.length === 0 && trimmed.startsWith('#!')) {
        shebang = true;
        current.body.push('');
        continue;
      }
      if (shebang) current.body[0] = `${current.body[0] ?? ''}\n${trimmed}`.replace(/^\n/, '');
      else current.body.push(trimmed.replace(/^[@-]+\s*/, ''));
      continue;
    }
    if (line.trim() === '') continue;
    current = undefined;
    shebang = false;
    if (/^\s*#/.test(line) || /^\s*\[/.test(line) || /^(alias|set|import|mod|export)\b/.test(line)) continue;
    const match = /^@?([A-Za-z_][\w-]*)([^:=]*?):(?!=)\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    const dependencies = (match[3] ?? '')
      .replace(/#.*$/, '')
      .split(/&&|\s+/)
      .map((d) => d.replace(/^\(|\)$/g, '').trim())
      .filter((d) => d !== '' && /^[A-Za-z_][\w-]*$/.test(d));
    current = { dependencies, body: [] };
    recipes.set(match[1], current);
  }
  for (const recipe of recipes.values()) recipe.body = joinContinuations(recipe.body).filter((l) => l !== '');
  return recipes;
}

/** `justfile`, `Justfile` or `.justfile` in `dir`, else the nearest ancestor. Dependencies are expanded like Makefile prerequisites. */
export const justfileEntryPoints: EntryPointKind = {
  id: 'justfile',
  list(repoPath, dir) {
    const found = findFile(repoPath, dir, JUSTFILES, false);
    return found ? [...parseJustfile(found.text).keys()].map((name) => ({ name, invoke: `just ${name}` })) : [];
  },
  lookup(repoPath, dir, name) {
    const found = findFile(repoPath, dir, JUSTFILES, true);
    if (!found) return undefined;
    const recipes = parseJustfile(found.text);
    const key = name === '@default' ? [...recipes.keys()][0] : name;
    const recipe = key === undefined ? undefined : recipes.get(key);
    return recipe ? { file: found.file, bodies: [...recipe.dependencies.map((d) => `just ${d}`), ...recipe.body] } : undefined;
  },
};
