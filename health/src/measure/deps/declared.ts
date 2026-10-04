import path from 'node:path';
import semver from 'semver';
import type { Group } from '../../scope/types.js';
import { isValidSpecifier, normalizeName, poetryToPep440 } from '../../util/pep440.js';
import { readToml } from '../../util/toml.js';
import { joinRel, readTrackedText, trackedIn, trackedSet } from './files.js';

export interface DeclaredDep {
  /** npm name as written, Python name PEP 503 normalized. */
  name: string;
  /** npm range or PEP 440 specifier ('' means any version). */
  spec: string;
  dev: boolean;
  /** False for workspace:, file:, link:, git, URL, alias and other non-registry specifiers. */
  registry: boolean;
  /** npm `optionalDependencies`: declared, but not a "declared direct dependency" for 5.5. */
  optional?: boolean;
}

export interface Manifest {
  /** Repo-relative path of the manifest file. */
  file: string;
  kind: 'package.json' | 'pyproject.toml' | 'Pipfile' | 'requirements';
  deps: DeclaredDep[];
  warnings: string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

// ---- npm --------------------------------------------------------------------------------

function npmManifest(repoPath: string, pkg: string): Manifest | undefined {
  const file = joinRel(pkg, 'package.json');
  const text = readTrackedText(repoPath, file);
  if (text === null) return undefined;
  const warnings: string[] = [];
  let json: Record<string, unknown> | undefined;
  try {
    json = record(JSON.parse(text));
  } catch {
    warnings.push(`${file}: invalid JSON, ignored`);
  }
  const deps: DeclaredDep[] = [];
  const sections: [string, boolean][] = [
    ['dependencies', false],
    ['devDependencies', true],
    ['optionalDependencies', false],
  ];
  for (const [section, dev] of sections) {
    const optional = section === 'optionalDependencies';
    for (const [name, spec] of Object.entries(record(json?.[section]) ?? {})) {
      if (typeof spec !== 'string') continue;
      deps.push({ name, spec, dev, registry: semver.validRange(spec) !== null, ...(optional ? { optional } : {}) });
    }
  }
  return { file, kind: 'package.json', deps, warnings };
}

// ---- Python -----------------------------------------------------------------------------

/** One PEP 508 requirement string, or undefined when it is not a requirement. */
export function parseRequirement(line: string, dev: boolean): DeclaredDep | undefined {
  const withoutMarker = (line.split(';')[0] ?? '').trim();
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(withoutMarker);
  if (!m?.[1]) return undefined;
  let rest = (m[2] ?? '').trim();
  if (rest.startsWith('@')) return { name: normalizeName(m[1]), spec: '', dev, registry: false };
  if (rest.startsWith('(') && rest.endsWith(')')) rest = rest.slice(1, -1).trim();
  rest = rest.replace(/\s+/g, '');
  if (!isValidSpecifier(rest)) return undefined;
  return { name: normalizeName(m[1]), spec: rest, dev, registry: true };
}

function requirementList(value: unknown, dev: boolean): DeclaredDep[] {
  if (!Array.isArray(value)) return [];
  const found: DeclaredDep[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue; // include-group tables are skipped
    const dep = parseRequirement(entry, dev);
    if (dep) found.push(dep);
  }
  return found;
}

function groupedLists(value: unknown, dev: boolean): DeclaredDep[] {
  return Object.values(record(value) ?? {}).flatMap((list) => requirementList(list, dev));
}

function poetryTable(value: unknown, dev: boolean): DeclaredDep[] {
  const found: DeclaredDep[] = [];
  for (const [rawName, entry] of Object.entries(record(value) ?? {})) {
    if (rawName.toLowerCase() === 'python') continue;
    const name = normalizeName(rawName);
    const first = Array.isArray(entry) ? entry[0] : entry;
    if (typeof first === 'string') {
      found.push({ name, spec: poetryToPep440(first), dev, registry: true });
      continue;
    }
    const table = record(first);
    const version = table?.version;
    const nonRegistry = table === undefined || table.git !== undefined || table.path !== undefined || table.url !== undefined;
    if (nonRegistry || typeof version !== 'string') found.push({ name, spec: '', dev, registry: false });
    else found.push({ name, spec: poetryToPep440(version), dev, registry: true });
  }
  return found;
}

function pyprojectDeps(doc: Record<string, unknown>): DeclaredDep[] | undefined {
  const project = record(doc.project);
  const tool = record(doc.tool);
  const poetry = record(tool?.poetry);
  const uv = record(tool?.uv);
  const pdm = record(tool?.pdm);
  const sections: DeclaredDep[][] = [];
  let present = false;
  const take = (value: unknown, make: () => DeclaredDep[]): void => {
    if (value !== undefined) {
      present = true;
      sections.push(make());
    }
  };
  take(project?.dependencies, () => requirementList(project?.dependencies, false));
  take(project?.['optional-dependencies'], () => groupedLists(project?.['optional-dependencies'], true));
  take(doc['dependency-groups'], () => groupedLists(doc['dependency-groups'], true));
  take(uv?.['dev-dependencies'], () => requirementList(uv?.['dev-dependencies'], true));
  take(poetry?.dependencies, () => poetryTable(poetry?.dependencies, false));
  take(poetry?.['dev-dependencies'], () => poetryTable(poetry?.['dev-dependencies'], true));
  for (const group of Object.values(record(poetry?.group) ?? {})) {
    take(record(group)?.dependencies, () => poetryTable(record(group)?.dependencies, true));
  }
  take(pdm?.['dev-dependencies'], () => groupedLists(pdm?.['dev-dependencies'], true));
  return present ? sections.flat() : undefined;
}

function pipfileDeps(doc: Record<string, unknown>): DeclaredDep[] {
  const found: DeclaredDep[] = [];
  for (const [section, dev] of [['packages', false], ['dev-packages', true]] as const) {
    for (const [rawName, entry] of Object.entries(record(doc[section]) ?? {})) {
      const name = normalizeName(rawName);
      if (typeof entry === 'string') {
        found.push({ name, spec: entry === '*' ? '' : entry.replace(/\s+/g, ''), dev, registry: isValidSpecifier(entry === '*' ? '' : entry.replace(/\s+/g, '')) });
        continue;
      }
      const version = record(entry)?.version;
      if (typeof version === 'string') {
        const spec = version === '*' ? '' : version.replace(/\s+/g, '');
        found.push({ name, spec, dev, registry: isValidSpecifier(spec) });
      } else found.push({ name, spec: '', dev, registry: false });
    }
  }
  return found;
}

/** Requirement lines of a requirements file: comments, options and hash continuations removed. */
export function requirementLines(text: string): { line: string; hashed: boolean }[] {
  const joined = text.replace(/\\\r?\n/g, ' ');
  const lines: { line: string; hashed: boolean }[] = [];
  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line === '' || line.startsWith('-')) continue;
    const hashed = /--hash[=\s]/.test(line);
    const clean = line.replace(/\s--\S+(?:[= ]\S+)?/g, '').trim();
    lines.push({ line: clean, hashed });
  }
  return lines;
}

export function requirementFiles(repoPath: string, pkg: string): string[] {
  return trackedIn(repoPath, pkg === '.' ? '' : pkg).filter((f) => /^requirements.*\.txt$/.test(path.posix.basename(f)));
}

function pythonManifest(repoPath: string, pkg: string): Manifest | undefined {
  const warnings: string[] = [];
  const dir = pkg === '.' ? '' : pkg;
  const pyprojectFile = joinRel(dir, 'pyproject.toml');
  const requirements = (): DeclaredDep[] => {
    const found = new Map<string, DeclaredDep>();
    for (const file of requirementFiles(repoPath, pkg)) {
      const text = readTrackedText(repoPath, file) ?? '';
      for (const { line } of requirementLines(text)) {
        const dep = parseRequirement(line, false);
        if (dep && !found.has(dep.name)) found.set(dep.name, dep);
      }
    }
    return [...found.values()];
  };
  if (trackedSet(repoPath).has(pyprojectFile)) {
    const doc = readToml(path.join(path.resolve(repoPath), pyprojectFile));
    if (doc === undefined) warnings.push(`${pyprojectFile}: invalid TOML, ignored`);
    const deps = doc ? pyprojectDeps(doc) : undefined;
    return { file: pyprojectFile, kind: 'pyproject.toml', deps: deps ?? requirements(), warnings };
  }
  const pipfile = joinRel(dir, 'Pipfile');
  if (trackedSet(repoPath).has(pipfile)) {
    const doc = readToml(path.join(path.resolve(repoPath), pipfile));
    if (doc === undefined) warnings.push(`${pipfile}: invalid TOML, ignored`);
    return { file: pipfile, kind: 'Pipfile', deps: pipfileDeps(doc ?? {}), warnings };
  }
  const files = requirementFiles(repoPath, pkg);
  const first = files[0];
  if (first === undefined) return undefined;
  return { file: first, kind: 'requirements', deps: requirements(), warnings };
}

/** The unit's declared direct dependencies, or undefined when its package directory has no manifest. */
export function readManifest(repoPath: string, pkg: string, group: Group): Manifest | undefined {
  return group === 'python' ? pythonManifest(repoPath, pkg) : npmManifest(repoPath, pkg);
}
