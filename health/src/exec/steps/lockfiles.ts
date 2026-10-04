import path from 'node:path';
import type { CommandContext } from '../types.js';

export type JsManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export function inDir(ctx: CommandContext, name: string): string {
  return path.posix.join(ctx.dir, name);
}

/** The package manager the lockfile names; npm when there is none. */
export function jsManager(ctx: CommandContext): { manager: JsManager; locked: boolean } {
  const has = (name: string): boolean => ctx.tracked.has(inDir(ctx, name));
  if (has('pnpm-lock.yaml')) return { manager: 'pnpm', locked: true };
  if (has('yarn.lock')) return { manager: 'yarn', locked: true };
  if (has('bun.lock') || has('bun.lockb')) return { manager: 'bun', locked: true };
  return { manager: 'npm', locked: has('package-lock.json') || has('npm-shrinkwrap.json') };
}

/** `requirements*.txt` files directly in the directory, sorted. */
export function requirementsFiles(ctx: CommandContext): string[] {
  return [...ctx.tracked]
    .filter((file) => path.posix.dirname(file) === ctx.dir && /^requirements.*\.txt$/.test(path.posix.basename(file)))
    .map((file) => path.posix.basename(file))
    .sort();
}
