import path from 'node:path';
import { parse } from 'smol-toml';
import { readTracked, trackedPaths } from '../scope/tracked.js';
import { parseIni } from '../util/ini.js';

/** PEP 503 normalisation: lowercase, runs of `-`, `_` and `.` become `-`. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** The distribution name at the start of a requirement string (`Django[argon2]>=4 ; python_version>"3"`). */
function requirementName(text: string): string | undefined {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(text);
  return match?.[1] === undefined ? undefined : normalizeName(match[1]);
}

function readTomlTracked(repoPath: string, rel: string): Record<string, unknown> | undefined {
  const text = readTracked(repoPath, rel);
  if (text === null) return undefined;
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

function addRequirements(out: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = requirementName(entry);
    if (name !== undefined) out.add(name);
  }
}

function addKeys(out: Set<string>, value: unknown): void {
  for (const key of Object.keys(asRecord(value))) {
    if (key.toLowerCase() !== 'python') out.add(normalizeName(key));
  }
}

function addRequirementsFile(repoPath: string, rel: string, out: Set<string>, followIncludes: boolean): void {
  const text = readTracked(repoPath, rel);
  if (text === null) return;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line === '') continue;
    const include = /^(?:-r|--requirement)[\s=]+(\S+)/.exec(line);
    if (include?.[1] !== undefined) {
      if (followIncludes) addRequirementsFile(repoPath, path.posix.normalize(path.posix.join(path.posix.dirname(rel), include[1])), out, false);
      continue;
    }
    if (line.startsWith('-')) continue;
    const name = requirementName(line);
    if (name !== undefined) out.add(name);
  }
}

/**
 * Dependency names declared by the manifests in `dir` only (never an ancestor's): `[project]` dependencies and
 * optional dependencies, `[dependency-groups]`, `[tool.poetry]` tables, `requirements*.txt` (with `-r` includes one
 * level deep), `Pipfile` packages and `setup.cfg` `install_requires`. Names are PEP 503 normalised.
 */
export function pythonDeclaredDeps(repoPath: string, dir: string): Set<string> {
  const out = new Set<string>();
  const at = (name: string): string => (dir === '.' || dir === '' ? name : path.posix.join(dir, name));

  const pyproject = readTomlTracked(repoPath, at('pyproject.toml'));
  if (pyproject !== undefined) {
    const project = asRecord(pyproject.project);
    addRequirements(out, project.dependencies);
    for (const list of Object.values(asRecord(project['optional-dependencies']))) addRequirements(out, list);
    for (const list of Object.values(asRecord(pyproject['dependency-groups']))) addRequirements(out, list);
    const poetry = asRecord(asRecord(pyproject.tool).poetry);
    addKeys(out, poetry.dependencies);
    addKeys(out, poetry['dev-dependencies']);
    for (const group of Object.values(asRecord(poetry.group))) addKeys(out, asRecord(group).dependencies);
  }

  const prefix = dir === '.' || dir === '' ? '' : `${dir}/`;
  for (const file of trackedPaths(repoPath)) {
    if (!file.startsWith(prefix)) continue;
    const name = file.slice(prefix.length);
    if (/^requirements[^/]*\.txt$/.test(name)) addRequirementsFile(repoPath, file, out, true);
  }

  const pipfile = readTomlTracked(repoPath, at('Pipfile'));
  if (pipfile !== undefined) {
    addKeys(out, pipfile.packages);
    addKeys(out, pipfile['dev-packages']);
  }

  const setupCfg = readTracked(repoPath, at('setup.cfg'));
  if (setupCfg !== null) {
    const required = parseIni(setupCfg).options?.install_requires;
    if (required !== undefined) addRequirements(out, required.split('\n'));
  }
  return out;
}
