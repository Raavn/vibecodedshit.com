import path from 'node:path';
import { chooseJsLockfile } from '../../measure/deps/lockfiles.js';
export function inDir(ctx, name) {
    return path.posix.join(ctx.dir, name);
}
const MANAGER = {
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'bun.lock': 'bun',
    'bun.lockb': 'bun',
    'npm-shrinkwrap.json': 'npm',
    'package-lock.json': 'npm',
};
/** The package manager of the lockfile `chooseJsLockfile` picks (the one D5 reads); npm when there is none. */
export function jsManager(ctx) {
    const chosen = chooseJsLockfile(Object.keys(MANAGER).filter((name) => ctx.tracked.has(inDir(ctx, name))));
    return chosen === undefined ? { manager: 'npm', locked: false } : { manager: MANAGER[chosen] ?? 'npm', locked: true };
}
/** `requirements*.txt` files directly in the directory, sorted. */
export function requirementsFiles(ctx) {
    return [...ctx.tracked]
        .filter((file) => path.posix.dirname(file) === ctx.dir && /^requirements.*\.txt$/.test(path.posix.basename(file)))
        .map((file) => path.posix.basename(file))
        .sort();
}
