import { parseTomlText } from '../../util/toml.js';
import { findFile } from './find.js';
import type { EntryPointKind } from '../types.js';

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);
const cmdText = (value: unknown): string[] => (Array.isArray(value) ? [strs(value).join(' ')] : strs(value));
const strs = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : typeof value === 'string' ? [value] : []);
const sub = (value: unknown, ...keys: string[]): Obj => {
  let current: unknown = value;
  for (const key of keys) current = isObj(current) ? current[key] : undefined;
  return isObj(current) ? current : {};
};

/** One entry: `tool` namespaces the call form (`pdm`, `hatch:<env>`, `rye`, `poe`, `taskipy`, `scripts`). */
interface Entry {
  key: string;
  invoke: string;
  bodies: string[];
}

function pdm(doc: Obj): Entry[] {
  return Object.entries(sub(doc, 'tool', 'pdm', 'scripts')).map(([name, value]) => {
    const bodies = typeof value === 'string' ? [value] : isObj(value) ? [...cmdText(value.cmd), ...strs(value.shell), ...strs(value.composite).map((c) => `pdm run ${c}`)] : [];
    return { key: `pdm:${name}`, invoke: `pdm run ${name}`, bodies };
  });
}

function hatch(doc: Obj): Entry[] {
  const out: Entry[] = [];
  for (const [env, table] of Object.entries(sub(doc, 'tool', 'hatch', 'envs'))) {
    const scripts = isObj(table) && isObj(table.scripts) ? table.scripts : {};
    for (const [name, value] of Object.entries(scripts)) {
      const bodies = strs(value).map((c) => (Object.hasOwn(scripts, c.trim().split(/\s+/)[0] ?? '') ? `hatch run ${env}:${c.trim().split(/\s+/)[0]}` : c));
      out.push({ key: `hatch:${env}:${name}`, invoke: `hatch run ${env}:${name}`, bodies });
    }
  }
  return out;
}

function rye(doc: Obj): Entry[] {
  return Object.entries(sub(doc, 'tool', 'rye', 'scripts')).map(([name, value]) => {
    const bodies = typeof value === 'string' ? [value] : isObj(value) ? [...cmdText(value.cmd), ...strs(value.shell), ...strs(value.chain).map((c) => `rye run ${c}`)] : [];
    return { key: `rye:${name}`, invoke: `rye run ${name}`, bodies };
  });
}

function poe(doc: Obj): Entry[] {
  const tasks = sub(doc, 'tool', 'poe', 'tasks');
  const items = (list: unknown): string[] =>
    (Array.isArray(list) ? list : []).flatMap((item) => (typeof item === 'string' ? [Object.hasOwn(tasks, item.trim().split(/\s+/)[0] ?? '') ? `poe ${item}` : item] : isObj(item) ? [...cmdText(item.cmd), ...strs(item.shell)] : []));
  return Object.entries(tasks).map(([name, value]) => {
    const bodies = typeof value === 'string' ? [value] : isObj(value) ? [...cmdText(value.cmd), ...strs(value.shell), ...items(value.sequence), ...items(value.composite)] : [];
    return { key: `poe:${name}`, invoke: `poe ${name}`, bodies };
  });
}

function taskipy(doc: Obj): Entry[] {
  return Object.entries(sub(doc, 'tool', 'taskipy', 'tasks')).map(([name, value]) => ({
    key: `taskipy:${name}`,
    invoke: `task ${name}`,
    bodies: typeof value === 'string' ? [value] : isObj(value) ? strs(value.cmd) : [],
  }));
}

/** `[project.scripts]` and `[tool.poetry.scripts]` targets are `module:callable`: the entry exists and runs no recognised tool. */
function scripts(doc: Obj): Entry[] {
  const names = [...Object.keys(sub(doc, 'project', 'scripts')), ...Object.keys(sub(doc, 'tool', 'poetry', 'scripts'))];
  return [...new Set(names)].map((name) => ({ key: `scripts:${name}`, invoke: `uv run ${name}`, bodies: [] }));
}

function entries(repoPath: string, dir: string): { file: string; entries: Entry[] } | undefined {
  const found = findFile(repoPath, dir, ['pyproject.toml'], false);
  const doc = found ? parseTomlText(found.text) : undefined;
  if (!found || !doc) return undefined;
  return { file: found.file, entries: [...scripts(doc), ...pdm(doc), ...hatch(doc), ...rye(doc), ...poe(doc), ...taskipy(doc)] };
}

/** Script tables of the `pyproject.toml` in `dir`. Lookup names are the namespaced keys (`pdm:lint`, `hatch:default:test`). */
export const pyprojectEntryPoints: EntryPointKind = {
  id: 'pyproject',
  list(repoPath, dir) {
    return (entries(repoPath, dir)?.entries ?? []).map((e) => ({ name: e.key, invoke: e.invoke }));
  },
  lookup(repoPath, dir, name) {
    const read = entries(repoPath, dir);
    const entry = read?.entries.find((e) => e.key === name);
    return read && entry ? { file: read.file, bodies: entry.bodies } : undefined;
  },
};
