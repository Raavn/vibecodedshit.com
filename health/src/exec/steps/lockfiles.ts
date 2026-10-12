import path from 'node:path';
import { chooseJsLockfile } from '../../measure/deps/lockfiles.js';
import type { CommandContext } from '../types.js';

export type JsManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export function inDir(ctx: CommandContext, name: string): string {
  return path.posix.join(ctx.dir, name);
}

const MANAGER: Record<string, JsManager> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'npm-shrinkwrap.json': 'npm',
  'package-lock.json': 'npm',
};

/** The package manager of the lockfile `chooseJsLockfile` picks (the one D5 reads); npm when there is none. */
export function jsManager(ctx: CommandContext): { manager: JsManager; locked: boolean } {
  const chosen = chooseJsLockfile(Object.keys(MANAGER).filter((name) => ctx.tracked.has(inDir(ctx, name))));
  return chosen === undefined ? { manager: 'npm', locked: false } : { manager: MANAGER[chosen] ?? 'npm', locked: true };
}

/** `requirements*.txt` files directly in the directory, sorted. */
export function requirementsFiles(ctx: CommandContext): string[] {
  return [...ctx.tracked]
    .filter((file) => path.posix.dirname(file) === ctx.dir && /^requirements.*\.txt$/.test(path.posix.basename(file)))
    .map((file) => path.posix.basename(file))
    .sort();
}
