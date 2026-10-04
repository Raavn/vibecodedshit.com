import { parse } from 'smol-toml';
import { readTracked } from '../../../scope/tracked.js';
import { parseIni } from '../../../util/ini.js';

const DIRECTION_TYPES = new Set(['layers', 'forbidden', 'independence']);
/** The order import-linter itself tries its config files in. */
const CONFIG_NAMES = ['setup.cfg', '.importlinter', 'pyproject.toml'];

export interface DeclaredContract {
  name: string;
  type: string;
  /** Raw layer entries of a `layers` contract, one per line or array item (each may hold `|` and `:` siblings). */
  layers: string[];
  containers: string[];
}

export interface PyDeclared {
  /** Repo-relative posix path of the governing rules file. */
  file: string;
  /** Contracts of type layers, forbidden or independence. */
  contracts: DeclaredContract[];
}

const lines = (value: string | undefined): string[] =>
  (value ?? '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '');

function iniContracts(text: string, requireSection: boolean): DeclaredContract[] | undefined {
  const ini = parseIni(text);
  if (requireSection && ini.importlinter === undefined) return undefined;
  const out: DeclaredContract[] = [];
  for (const [section, values] of Object.entries(ini)) {
    if (!section.startsWith('importlinter:contract:')) continue;
    out.push({
      name: values.name ?? section.slice('importlinter:contract:'.length),
      type: (values.type ?? '').trim(),
      layers: lines(values.layers),
      containers: lines(values.containers),
    });
  }
  return out;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function tomlContracts(text: string, file: string, warnings: string[]): DeclaredContract[] | undefined {
  let doc: Record<string, unknown>;
  try {
    doc = parse(text);
  } catch {
    warnings.push(`${file}: could not be parsed, treated as absent`);
    return undefined;
  }
  const tool = doc.tool as Record<string, unknown> | undefined;
  const section = tool?.importlinter as Record<string, unknown> | undefined;
  if (section === undefined || typeof section !== 'object') return undefined;
  const list = Array.isArray(section.contracts) ? section.contracts : [];
  return list
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c, index) => ({
      name: typeof c.name === 'string' ? c.name : `contract-${index + 1}`,
      type: typeof c.type === 'string' ? c.type : '',
      layers: strings(c.layers),
      containers: strings(c.containers),
    }));
}

/**
 * The rules file that governs a unit: walking from the unit directory up to the repository root, at each directory
 * `setup.cfg`, `.importlinter`, `pyproject.toml` in that order; the first one with at least one layers, forbidden or
 * independence contract. Files with other contract types only, an unparseable file and a `setup.cfg` without
 * `[importlinter]` do not govern.
 */
export function findPyDeclared(repoPath: string, unitDir: string, warnings: string[], cache: Map<string, PyDeclared | null>): PyDeclared | undefined {
  let dir = unitDir;
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const file = dir === '.' ? name : `${dir}/${name}`;
      let result = cache.get(file);
      if (result === undefined) {
        const text = readTracked(repoPath, file);
        let contracts: DeclaredContract[] | undefined;
        if (text !== null) contracts = name === 'pyproject.toml' ? tomlContracts(text, file, warnings) : iniContracts(text, name === 'setup.cfg' || name === '.importlinter');
        const direction = contracts?.filter((c) => DIRECTION_TYPES.has(c.type)) ?? [];
        result = direction.length > 0 ? { file, contracts: direction } : null;
        cache.set(file, result);
      }
      if (result !== null) return result;
    }
    if (dir === '.') return undefined;
    const slash = dir.lastIndexOf('/');
    dir = slash === -1 ? '.' : dir.slice(0, slash);
  }
}
