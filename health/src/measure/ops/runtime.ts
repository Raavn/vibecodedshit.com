import path from 'node:path';
import { readPackageJson } from '../../manifest/package-json.js';
import { readTracked } from '../../scope/tracked.js';
import type { Group } from '../../scope/types.js';
import { parseTomlText } from '../../util/toml.js';
import { dirsUpward } from './entry-points.js';

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown): boolean => (typeof value === 'string' && value.trim() !== '') || (Array.isArray(value) && value.some(nonEmpty));

interface Probe {
  group: Group;
  /** True when the pin is there. A file that exists but is malformed pushes a warning and counts as not pinned. */
  check(repoPath: string, dir: string, warnings: string[]): boolean;
}

const fileHasContent =
  (name: string, group: Group): Probe => ({
    group,
    check: (repoPath, dir) => (readTracked(repoPath, path.posix.join(dir, name))?.trim() ?? '') !== '',
  });

function toml(repoPath: string, file: string, warnings: string[]): Obj | undefined {
  const text = readTracked(repoPath, file);
  if (text === null) return undefined;
  const doc = parseTomlText(text);
  if (!doc) warnings.push(`6.5: ${file} is not valid TOML, so it does not pin a runtime`);
  return doc;
}

const toolVersions =
  (tools: string[], group: Group): Probe => ({
    group,
    check: (repoPath, dir) =>
      (readTracked(repoPath, path.posix.join(dir, '.tool-versions')) ?? '')
        .split('\n')
        .some((line) => {
          const [tool, version] = line.trim().split(/\s+/);
          return tool !== undefined && tools.includes(tool) && version !== undefined && !version.startsWith('#');
        }),
  });

const mise =
  (tools: string[], group: Group): Probe => ({
    group,
    check(repoPath, dir, warnings) {
      const doc = toml(repoPath, path.posix.join(dir, 'mise.toml'), warnings);
      const table = doc && isObj(doc.tools) ? doc.tools : {};
      return tools.some((tool) => nonEmpty(table[tool]));
    },
  });

/** The pin files of the 6.5 `runtime_pinned` measure, by the words the YAML uses; a word the YAML adds that is not here pins nothing. */
const PROBES: Record<string, Probe[]> = {
  '.nvmrc': [fileHasContent('.nvmrc', 'typescript_javascript')],
  '.node-version': [fileHasContent('.node-version', 'typescript_javascript')],
  '.tool-versions': [toolVersions(['node', 'nodejs'], 'typescript_javascript'), toolVersions(['python'], 'python')],
  'mise.toml': [mise(['node', 'nodejs'], 'typescript_javascript'), mise(['python'], 'python')],
  'engines.node in package.json': [
    { group: 'typescript_javascript', check: (repoPath, dir) => nonEmpty(readPackageJson(repoPath, dir)?.engines.node) },
  ],
  'volta in package.json': [
    { group: 'typescript_javascript', check: (repoPath, dir) => nonEmpty(readPackageJson(repoPath, dir)?.volta?.node) },
  ],
  '.python-version': [fileHasContent('.python-version', 'python')],
  'requires-python in pyproject.toml': [
    {
      group: 'python',
      check(repoPath, dir, warnings) {
        const doc = toml(repoPath, path.posix.join(dir, 'pyproject.toml'), warnings);
        return doc !== undefined && isObj(doc.project) && nonEmpty(doc.project['requires-python']);
      },
    },
  ],
  'runtime.txt': [fileHasContent('runtime.txt', 'python')],
};

/** Looked up at the unit's package directory, then each ancestor up to the repository root. Poetry's `python = "^3.12"` dependency does not count. */
export function runtimePinned(repoPath: string, dir: string, group: Group, pinFiles: string[], warnings: string[]): boolean {
  for (const d of dirsUpward(dir)) {
    for (const word of pinFiles) {
      for (const probe of PROBES[word] ?? []) {
        if (probe.group === group && probe.check(repoPath, d, warnings)) return true;
      }
    }
  }
  return false;
}
