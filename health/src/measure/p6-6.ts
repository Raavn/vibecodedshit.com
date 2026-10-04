import path from 'node:path';
import { readTracked, trackedPaths } from '../scope/tracked.js';
import { extractCommands, type DocCommand } from './ops/docs-commands.js';
import { DocResolver } from './ops/docs-resolve.js';
import { logicUnits } from './units.js';
import type { Measurer } from './types.js';

const AGENT_FILES = ['agents.md', 'claude.md'];
const README_NAMES = ['readme.md', 'readme', 'readme.rst', 'readme.txt'];

/** The tracked file of `dir` whose name matches one of `names` case-insensitively, in the order of `names`. */
function findCi(tracked: string[], dir: string, names: string[]): string | undefined {
  const inDir = tracked.filter((f) => path.posix.dirname(f) === dir);
  for (const name of names) {
    const found = inDir.find((f) => path.posix.basename(f).toLowerCase() === name);
    if (found) return found;
  }
  return undefined;
}

export const p66: Measurer = {
  id: '6.6',
  layer: 'static',
  async measure({ scope, repoPath, methodology }) {
    const lists = methodology.d6;
    const tracked = trackedPaths(repoPath);
    const words = {
      commandWords: new Set([
        ...lists.docPackageManagers,
        ...[...lists.typecheckers, ...lists.linters, ...lists.testRunners].map((t) => (t === 'node --test' ? 'node' : t.replace(/^python3? -m /, ''))),
      ]),
    };
    const resolver = new DocResolver(repoPath, lists);
    const commandsOf = (file: string | undefined): DocCommand[] => {
      const text = file === undefined ? null : readTracked(repoPath, file);
      return text === null ? [] : extractCommands(text, words);
    };

    const agentFiles = AGENT_FILES.flatMap((name) => findCi(tracked, '.', [name]) ?? []);
    const agent = agentFiles.flatMap((file) => commandsOf(file).map((command) => ({ file, command })));
    const unresolved = agent.filter(({ command }) => !resolver.resolves(command, '.'));
    const warnings = unresolved.slice(0, 5).map(({ file, command }) => `6.6: ${file}:${command.line}: \`${command.text}\` does not resolve`);

    const rootReadme = findCi(tracked, '.', README_NAMES);
    const rootReadmeHasCommands = commandsOf(rootReadme).length > 0;
    const units = logicUnits(scope).map((unit) => {
      let level: string;
      if (agent.length > 0) level = unresolved.length === 0 ? 'agent_file' : 'readme';
      else {
        const own = unit.dir === '.' ? undefined : findCi(tracked, unit.dir, README_NAMES);
        const hasCommands = own !== undefined && commandsOf(own).length > 0 ? true : rootReadmeHasCommands;
        level = hasCommands ? 'readme' : 'none';
      }
      return { package: unit.package, group: unit.group, weight: unit.weight, raw: { kind: 'level' as const, level } };
    });
    return { status: 'measured', units, ...(warnings.length === 0 ? {} : { warnings }) };
  },
};
