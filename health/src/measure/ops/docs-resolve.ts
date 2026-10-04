import path from 'node:path';
import type { D6Lists } from '../../methodology/load.js';
import { readPackageJson } from '../../manifest/package-json.js';
import { pythonDeclaredDeps } from '../../manifest/python.js';
import { trackedPaths } from '../../scope/tracked.js';
import { findFile } from '../../scripts/entry-points/find.js';
import { justfileEntryPoints } from '../../scripts/entry-points/justfile.js';
import { makefileEntryPoints } from '../../scripts/entry-points/makefile.js';
import { noxEntryPoints } from '../../scripts/entry-points/nox.js';
import { packageJsonEntryPoints } from '../../scripts/entry-points/package-json.js';
import { pyprojectEntryPoints } from '../../scripts/entry-points/pyproject.js';
import { toxEntryPoints } from '../../scripts/entry-points/tox.js';
import { dirsUpward } from './entry-points.js';
import type { DocCommand } from './docs-commands.js';

const NODE_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'update', 'up', 'link', 'init', 'dlx', 'audit', 'outdated', 'publish', 'pack', 'version', 'config',
  'cache', 'rebuild', 'prune', 'dedupe', 'why', 'ls', 'list', 'x',
]);
const UV_BUILTINS = new Set(['sync', 'lock', 'add', 'remove', 'venv', 'pip', 'python', 'tool', 'init', 'build', 'publish']);
const POETRY_BUILTINS = new Set(['install', 'add', 'remove', 'lock', 'shell', 'build', 'publish', 'init', 'update', 'show', 'env', 'config']);
const PDM_BUILTINS = new Set(['install', 'add', 'remove', 'lock', 'sync', 'build', 'publish', 'init']);
const PYTHON_STDLIB = new Set(['venv', 'pip', 'http.server', 'json.tool', 'unittest', 'pytest', 'ensurepip', 'build', 'compileall', 'timeit', 'zipapp', 'http', 'site', 'sysconfig']);
const WORKSPACE_FLAGS = new Set(['-w', '--workspace', '--workspaces', '--filter', '-F', '-r', '--recursive', '--cwd']);
const VALUE_FLAGS = new Set(['--prefix', '-C', '--cwd', '--filter', '-F', '--workspace', '--directory']);
const MAKEFILES = ['Makefile', 'makefile', 'GNUmakefile'];

const join = (dir: string, next: string | undefined): string => (next === undefined ? dir : path.posix.normalize(path.posix.join(dir, next)));

export class DocResolver {
  private readonly tracked: Set<string>;
  private manifests: { dir: string; deps: Set<string>; scripts: Set<string> }[] | undefined;
  private readonly toolNames: Set<string>;

  constructor(
    private readonly repoPath: string,
    lists: Pick<D6Lists, 'typecheckers' | 'linters' | 'testRunners'>,
  ) {
    this.tracked = new Set(trackedPaths(repoPath));
    this.toolNames = new Set(
      [...lists.typecheckers, ...lists.linters, ...lists.testRunners].map((t) => (t === 'node --test' ? 'node' : t.replace(/^python3? -m /, ''))),
    );
  }

  private allManifests(): { dir: string; deps: Set<string>; scripts: Set<string> }[] {
    this.manifests ??= [...this.tracked]
      .filter((f) => path.posix.basename(f) === 'package.json')
      .map((f) => {
        const dir = path.posix.dirname(f);
        const pkg = readPackageJson(this.repoPath, dir);
        return { dir, deps: new Set(Object.keys(pkg?.dependencies ?? {})), scripts: new Set(Object.keys(pkg?.scripts ?? {})) };
      });
    return this.manifests;
  }

  private hasScript(dir: string, name: string): boolean {
    return packageJsonEntryPoints.lookup(this.repoPath, dir, name) !== undefined;
  }

  private declaredPython(dir: string, name: string): boolean {
    const wanted = name.toLowerCase().replace(/[-_.]+/g, '-');
    return dirsUpward(dir).some((d) => pythonDeclaredDeps(this.repoPath, d).has(wanted));
  }

  private firstPartyModule(dir: string, name: string): boolean {
    const top = name.split('.').join('/');
    return [dir, 'src'].some((base) => [`${top}.py`, `${top}/__init__.py`, `${top}/__main__.py`].some((f) => this.tracked.has(path.posix.normalize(path.posix.join(base, f)))));
  }

  /** `npx <t>`, `uv run <t>`, `python -m <t>` and a bare recognised tool: resolves for a script, a recognised tool, a declared dependency, a stdlib or first-party module. */
  private toolRef(tool: string | undefined, dir: string, runner: string): boolean {
    if (tool === undefined) return true;
    if (runner === 'python -m' && (PYTHON_STDLIB.has(tool) || this.firstPartyModule(dir, tool))) return true;
    if ((runner === 'uv run' || runner === 'poetry run') && pyprojectEntryPoints.lookup(this.repoPath, dir, `scripts:${tool}`) !== undefined) return true;
    if (runner === 'pdm run' && pyprojectEntryPoints.lookup(this.repoPath, dir, `pdm:${tool}`) !== undefined) return true;
    if (this.toolNames.has(tool)) return true;
    if (this.allManifests().some((m) => m.deps.has(tool))) return true;
    return this.declaredPython(dir, tool);
  }

  private nodeCommand(runner: string, tokens: string[], baseDir: string): boolean {
    let dir = baseDir;
    let workspace = false;
    const args: string[] = [];
    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i] as string;
      if (token === '--') break;
      if (WORKSPACE_FLAGS.has(token)) workspace = true;
      if (token === '--prefix' || token === '-C' || token === '--cwd') {
        dir = join(baseDir, tokens[i + 1]);
        i += 1;
      } else if (VALUE_FLAGS.has(token)) i += 1;
      else if (token.startsWith('--prefix=')) dir = join(baseDir, token.slice(9));
      else if (!token.startsWith('-')) args.push(token);
    }
    const sub = args[0];
    if (sub === undefined || NODE_BUILTINS.has(sub)) return true;
    if (sub === 'exec' || (runner === 'bun' && sub === 'x')) return this.toolRef(args[1], dir, runner === 'pnpm' ? 'pnpm exec' : runner);
    let name: string | undefined;
    let toolFallback = false;
    if (sub === 'workspace') name = args[2];
    else if (sub === 'run' || sub === 'run-script') name = args[1];
    else if (['test', 'start', 'stop', 'restart'].includes(sub)) name = sub;
    else if (runner === 'yarn' || runner === 'pnpm') {
      name = sub;
      toolFallback = true;
    } else return true;
    if (name === undefined) return true;
    if (workspace || sub === 'workspace' ? this.allManifests().some((m) => m.scripts.has(name)) : this.hasScript(dir, name)) return true;
    if (name === 'start' && runner === 'npm' && this.tracked.has(path.posix.join(dir, 'server.js'))) return true;
    return toolFallback && this.toolRef(name, dir, runner);
  }

  private makeCommand(tokens: string[], baseDir: string): boolean {
    let dir = baseDir;
    const targets: string[] = [];
    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i] as string;
      if (token === '-C' || token === '--directory') {
        dir = join(baseDir, tokens[i + 1]);
        i += 1;
      } else if (token === '-f' || token === '--file') i += 1;
      else if (!token.startsWith('-') && !token.includes('=')) targets.push(token);
    }
    const names = new Set(makefileEntryPoints.list(this.repoPath, dir).map((e) => e.name));
    const exists = MAKEFILES.some((m) => this.tracked.has(path.posix.join(dir, m)));
    return targets.length === 0 ? exists : targets.every((t) => names.has(t));
  }

  private justCommand(tokens: string[], baseDir: string): boolean {
    let dir = baseDir;
    const recipes: string[] = [];
    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i] as string;
      if (token === '-d' || token === '--working-directory') {
        dir = join(baseDir, tokens[i + 1]);
        i += 1;
      } else if (token === '-f' || token === '--justfile') i += 1;
      else if (!token.startsWith('-') && !token.includes('=')) recipes.push(token);
    }
    if (recipes.length === 0) return findFile(this.repoPath, dir, ['justfile', 'Justfile', '.justfile'], true) !== undefined;
    return recipes.every((r) => justfileEntryPoints.lookup(this.repoPath, dir, r) !== undefined);
  }

  /** Whether one documented command resolves. `dir` is the document's directory with the command's `cd` already applied. */
  resolves(command: DocCommand, docDir: string): boolean {
    const dir = join(docDir, command.cd === '.' ? undefined : command.cd);
    const tokens = command.tokens;
    const first = tokens[0] as string;
    switch (first) {
      case 'npm':
      case 'pnpm':
      case 'yarn':
      case 'bun':
        return this.nodeCommand(first, tokens, dir);
      case 'npx': {
        const tool = tokens.slice(1).find((t) => !t.startsWith('-'));
        return this.toolRef(tool, dir, 'npx');
      }
      case 'make':
        return this.makeCommand(tokens, dir);
      case 'just':
        return this.justCommand(tokens, dir);
      case 'pip':
      case 'pipenv':
        return true;
      case 'uv':
      case 'poetry':
      case 'pdm': {
        const builtins = first === 'uv' ? UV_BUILTINS : first === 'poetry' ? POETRY_BUILTINS : PDM_BUILTINS;
        const sub = tokens[1];
        if (sub === undefined || builtins.has(sub)) return true;
        if (sub !== 'run') return first === 'uv';
        const tool = tokens.slice(2).find((t) => !t.startsWith('-'));
        if (tool === 'python' || tool === 'python3') return this.pythonCommand(tokens.slice(tokens.indexOf(tool)), dir);
        return this.toolRef(tool, dir, `${first} run`);
      }
      case 'python':
        return this.pythonCommand(tokens, dir);
      case 'tox': {
        const envs = tokens.flatMap((t, i) => (tokens[i - 1] === '-e' ? t.split(',') : []));
        return envs.length === 0 ? toxEntryPoints.fileFor?.(this.repoPath, dir) !== undefined : envs.every((e) => toxEntryPoints.lookup(this.repoPath, dir, e) !== undefined);
      }
      case 'nox': {
        const sessions = tokens.flatMap((t, i) => (['-s', '--session', '-e', '--sessions'].includes(tokens[i - 1] ?? '') ? t.split(',') : []));
        return sessions.length === 0 ? noxEntryPoints.fileFor?.(this.repoPath, dir) !== undefined : sessions.every((s) => noxEntryPoints.lookup(this.repoPath, dir, s) !== undefined);
      }
      default:
        return this.toolRef(first, dir, 'bare');
    }
  }

  private pythonCommand(tokens: string[], dir: string): boolean {
    const arg = tokens[1];
    if (arg === undefined || arg === '-c' || arg === '-' || arg === '-m') {
      if (arg === '-m') return this.toolRef(tokens[2], dir, 'python -m');
      return true;
    }
    if (arg.startsWith('-')) return true;
    return this.tracked.has(path.posix.normalize(path.posix.join(dir, arg)));
  }
}
