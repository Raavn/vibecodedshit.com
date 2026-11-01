import { parseIni } from '../../util/ini.js';
import { parseTomlText } from '../../util/toml.js';
import { findFile } from './find.js';
import type { EntryPointKind } from '../types.js';

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);

interface Env {
  commandsPre: string[];
  commands: string[];
  commandsPost: string[];
}

interface ToxConfig {
  file: string;
  envlist: string[];
  /** Section name (`testenv`, `testenv:lint`) or env name to its commands. `base` is `[testenv]`. */
  base: Partial<Env>;
  envs: Map<string, Partial<Env>>;
}

/** `py{311,312}-lint` becomes `py311-lint` and `py312-lint`. */
function expandBraces(text: string): string[] {
  const match = /^(.*?)\{([^{}]*)\}(.*)$/.exec(text);
  if (!match) return [text];
  const [, head = '', set = '', tail = ''] = match;
  return set.split(',').flatMap((item) => expandBraces(`${head}${item.trim()}${tail}`));
}

function lines(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/** Split on commas and newlines outside braces, then expand brace sets. */
function envList(value: string | undefined): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value ?? '') {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if ((ch === ',' || ch === '\n') && depth <= 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts.map((e) => e.trim()).filter((e) => e !== '').flatMap(expandBraces);
}

function fromIni(file: string, text: string): ToxConfig {
  const ini = parseIni(text);
  const section = (name: string): Partial<Env> => {
    const s = ini[name] ?? {};
    return { commandsPre: lines(s.commands_pre), commands: lines(s.commands), commandsPost: lines(s.commands_post) };
  };
  const envs = new Map<string, Partial<Env>>();
  for (const name of Object.keys(ini)) if (name.startsWith('testenv:')) envs.set(name.slice('testenv:'.length), section(name));
  return { file, envlist: envList(ini.tox?.envlist), base: section('testenv'), envs };
}

function commandText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map((v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' ') : typeof v === 'string' ? v : '')).filter((v) => v !== '');
  return [];
}

function fromToml(file: string, doc: Obj): ToxConfig | undefined {
  const table = file.endsWith('pyproject.toml') ? (isObj(doc.tool) && isObj(doc.tool.tox) ? doc.tool.tox : undefined) : doc;
  if (!table) return undefined;
  if (typeof table.legacy_tox_ini === 'string') return fromIni(file, table.legacy_tox_ini);
  const base: Partial<Env> = { commands: commandText(isObj(table.env_run_base) ? table.env_run_base.commands : undefined) };
  const envs = new Map<string, Partial<Env>>();
  const rawEnvs = isObj(table.env) ? table.env : {};
  for (const [name, value] of Object.entries(rawEnvs)) if (isObj(value)) envs.set(name, { commands: commandText(value.commands) });
  const envlist = Array.isArray(table.env_list) ? table.env_list.filter((e): e is string => typeof e === 'string').flatMap(expandBraces) : [];
  return { file, envlist, base, envs };
}

function readToxConfig(repoPath: string, dir: string): ToxConfig | undefined {
  const ini = findFile(repoPath, dir, ['tox.ini'], false);
  if (ini) return fromIni(ini.file, ini.text);
  for (const name of ['tox.toml', 'pyproject.toml']) {
    const found = findFile(repoPath, dir, [name], false);
    const doc = found ? parseTomlText(found.text) : undefined;
    const config = found && doc ? fromToml(found.file, doc) : undefined;
    if (config) return config;
  }
  return undefined;
}

/** `{envpython} -m` becomes `python -m`; `{posargs}`, `{toxinidir}` and other `{...}` fields are dropped. */
function substitute(command: string, factors: string[]): string | undefined {
  let text = command.trim();
  const factor = /^([A-Za-z0-9_.!,-]+):\s+(.*)$/.exec(text);
  if (factor?.[1] && factor[2] !== undefined) {
    const wanted = factor[1].split(',').some((f) => (f.startsWith('!') ? !factors.includes(f.slice(1)) : factors.includes(f)));
    if (!wanted) return undefined;
    text = factor[2];
  }
  text = text.replace(/\{envpython\}/g, 'python').replace(/\{[^{}]*\}/g, '').replace(/^[-!]+\s*/, '').replace(/\s+/g, ' ').trim();
  return text === '' ? undefined : text;
}

function envBodies(config: ToxConfig, name: string): string[] | undefined {
  const factors = name.split('-');
  const section = config.envs.get(name) ?? factors.map((f) => config.envs.get(f)).find((e) => e !== undefined);
  const known = section !== undefined || config.envlist.includes(name) || name === '@base';
  if (!known) return undefined;
  const pick = (key: keyof Env): string[] => section?.[key] ?? config.base[key] ?? [];
  return [...pick('commandsPre'), ...pick('commands'), ...pick('commandsPost')].flatMap((c) => substitute(c, factors) ?? []);
}

/** `tox.ini`, `tox.toml` or `[tool.tox]` in `dir`. A call is `tox [-e <envs>]`. */
export const toxEntryPoints: EntryPointKind = {
  id: 'tox',
  fileFor: (repoPath, dir) => readToxConfig(repoPath, dir)?.file,
  list(repoPath, dir) {
    const config = readToxConfig(repoPath, dir);
    if (!config) return [];
    const names = config.envlist.length > 0 ? config.envlist : [...config.envs.keys()];
    return [...new Set(names)].map((name) => ({ name, invoke: `tox -e ${name}` }));
  },
  lookup(repoPath, dir, name) {
    const config = readToxConfig(repoPath, dir);
    if (!config) return undefined;
    if (name === '@default') {
      const names = config.envlist.length > 0 ? config.envlist : ['@base'];
      return { file: config.file, bodies: names.flatMap((n) => envBodies(config, n) ?? []) };
    }
    const bodies = envBodies(config, name);
    return bodies === undefined ? undefined : { file: config.file, bodies };
  },
};
