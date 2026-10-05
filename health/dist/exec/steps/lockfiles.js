import path from 'node:path';
export function inDir(ctx, name) {
    return path.posix.join(ctx.dir, name);
}
/** The package manager the lockfile names; npm when there is none. */
export function jsManager(ctx) {
    const has = (name) => ctx.tracked.has(inDir(ctx, name));
    if (has('pnpm-lock.yaml'))
        return { manager: 'pnpm', locked: true };
    if (has('yarn.lock'))
        return { manager: 'yarn', locked: true };
    if (has('bun.lock') || has('bun.lockb'))
        return { manager: 'bun', locked: true };
    return { manager: 'npm', locked: has('package-lock.json') || has('npm-shrinkwrap.json') };
}
/** `requirements*.txt` files directly in the directory, sorted. */
export function requirementsFiles(ctx) {
    return [...ctx.tracked]
        .filter((file) => path.posix.dirname(file) === ctx.dir && /^requirements.*\.txt$/.test(path.posix.basename(file)))
        .map((file) => path.posix.basename(file))
        .sort();
}
