import path from 'node:path';
import type { PlannedRoot } from '../plan.js';
import type { Scope, ScopedFile } from '../../scope/types.js';
import type { TestInvocation, TestRunnerName } from '../types.js';
import { runnerInScript, scriptArgs } from './script.js';

const DEPENDENCY_ORDER = ['vitest', 'jest', 'mocha'] as const;
const PYTHON_MANIFESTS = /^(?:pyproject\.toml|setup\.py|setup\.cfg|Pipfile|tox\.ini|requirements.*\.txt)$/;

function isUnder(dir: string, parent: string): boolean {
  return parent === '.' || dir === parent || dir.startsWith(`${parent}/`);
}

/**
 * The runner a package.json declares: the one its `test` script names, else the first of vitest,
 * jest, mocha among the dependencies. Null when it declares none (Playwright and Cypress are never run).
 */
export function jsRunner(packageJson: string | null): { runner: Exclude<TestRunnerName, 'pytest'>; args: string[] } | null {
  if (packageJson === null) return null;
  let pkg: { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  try {
    pkg = JSON.parse(packageJson) as typeof pkg;
  } catch {
    return null;
  }
  const script = typeof pkg.scripts?.test === 'string' ? pkg.scripts.test : '';
  const named = runnerInScript(script);
  if (named) return { runner: named, args: scriptArgs(script, named) };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const runner = DEPENDENCY_ORDER.find((name) => name in deps);
  return runner ? { runner, args: [] } : null;
}

export interface DetectInput {
  roots: PlannedRoot[];
  scope: Pick<Scope, 'files' | 'packages'>;
  tracked: Set<string>;
  read(rel: string): string | null;
}

function pythonHasTests(input: DetectInput, root: PlannedRoot): boolean {
  const underRoot = (file: ScopedFile): boolean => file.group === 'python' && isUnder(path.posix.dirname(file.path), root.dir);
  if (input.scope.files.some((file) => file.role === 'test' && underRoot(file))) return true;
  const inRoot = (name: string): string => path.posix.join(root.dir, name);
  if (input.tracked.has(inRoot('tox.ini')) || input.tracked.has(inRoot('noxfile.py'))) return true;
  for (const file of input.tracked) {
    if (path.posix.dirname(file) !== root.dir || !PYTHON_MANIFESTS.test(path.posix.basename(file))) continue;
    if (/pytest/.test(input.read(file) ?? '')) return true;
  }
  return false;
}

/**
 * Which test runs to make. TypeScript/JavaScript: the install root when its package.json declares a
 * runner, otherwise each workspace package under it that does. Python: one pytest run per install root
 * that has a pytest dependency, a test file or a tox/nox config (pytest runs unittest suites too).
 * At most one invocation per directory.
 */
export function detectInvocations(input: DetectInput): TestInvocation[] {
  const invocations: TestInvocation[] = [];
  for (const root of input.roots) {
    if (root.group === 'python') {
      if (pythonHasTests(input, root)) invocations.push({ dir: root.dir, group: 'python', runner: 'pytest', args: [] });
      continue;
    }
    const manifest = (dir: string): string => path.posix.join(dir, 'package.json');
    const own = jsRunner(input.read(manifest(root.dir)));
    if (own) {
      invocations.push({ dir: root.dir, group: root.group, ...own });
      continue;
    }
    for (const dir of [...input.scope.packages].sort()) {
      if (dir === root.dir || !isUnder(dir, root.dir)) continue;
      const member = jsRunner(input.read(manifest(dir)));
      if (member) invocations.push({ dir, group: root.group, ...member });
    }
  }
  return invocations;
}

const JS_EXTENSIONS = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

/** Directory-level globs of the logic files beneath `dir`, relative to it (a file at the top is named exactly). */
export function logicGlobs(logicFiles: string[], dir: string): string[] {
  const globs = new Set<string>();
  for (const file of logicFiles) {
    const rel = path.posix.relative(dir, file);
    const [top] = rel.split('/');
    if (!top) continue;
    globs.add(top === rel ? rel : `${top}/**/*.${JS_EXTENSIONS}`);
  }
  return [...globs].sort();
}

/** `--cov` targets for pytest: each top-level directory with Python logic, and top-level modules by name. */
export function pythonTargets(logicFiles: string[], dir: string): string[] {
  const targets = new Set<string>();
  for (const file of logicFiles) {
    const rel = path.posix.relative(dir, file);
    const [top] = rel.split('/');
    if (!top) continue;
    targets.add(top === rel ? top.replace(/\.py$/, '') : top);
  }
  return [...targets].sort();
}
