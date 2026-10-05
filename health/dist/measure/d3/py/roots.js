import path from 'node:path';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Repo-relative directory of the root package. */
export const rootPackageDir = (root) => (root.dir === '.' ? root.name : `${root.dir}/${root.name}`);
/**
 * First-party root packages of a unit. Source roots: `<unit>/src` (when it holds in-scope Python files and has no
 * `__init__.py`) and the unit directory. Root packages are the identifier-named child directories of a source root
 * that hold an in-scope Python file at any depth, with or without `__init__.py`. When a name occurs under both
 * source roots the `src` one wins.
 */
export function pythonRoots(unitDir, files, tracked, warnings) {
    const at = (rel) => (unitDir === '.' ? rel : `${unitDir}/${rel}`);
    const srcDir = at('src');
    const srcHasFiles = files.some((f) => f.startsWith(`${srcDir}/`));
    const srcIsRoot = srcHasFiles && !tracked.has(`${srcDir}/__init__.py`);
    const sourceRoots = srcIsRoot ? [srcDir, unitDir] : [unitDir];
    const found = new Map();
    for (const sourceRoot of sourceRoots) {
        const prefix = sourceRoot === '.' ? '' : `${sourceRoot}/`;
        const children = new Set();
        for (const file of files) {
            if (!file.startsWith(prefix))
                continue;
            const parts = file.slice(prefix.length).split('/');
            if (parts.length >= 2)
                children.add(parts[0]);
        }
        for (const name of [...children].sort()) {
            if (!IDENTIFIER.test(name))
                continue;
            if (sourceRoot === unitDir && srcIsRoot && name === 'src')
                continue;
            const existing = found.get(name);
            if (existing !== undefined) {
                warnings.push(`${path.posix.join(existing.dir, name)} and ${path.posix.join(sourceRoot, name)} share the package name ${name}, the src one is used`);
                continue;
            }
            found.set(name, { dir: sourceRoot, name });
        }
    }
    return [...found.values()];
}
/** Dotted module name of a file below a root, or undefined when it is not in the root or a segment is not an identifier. */
export function moduleName(root, file) {
    const prefix = root.dir === '.' ? '' : `${root.dir}/`;
    if (!file.startsWith(`${prefix}${root.name}/`) || !file.endsWith('.py'))
        return undefined;
    const parts = file.slice(prefix.length, -3).split('/');
    if (parts[parts.length - 1] === '__init__')
        parts.pop();
    return parts.every((p) => IDENTIFIER.test(p)) ? parts.join('.') : undefined;
}
export function rootOf(roots, file) {
    return roots.find((root) => {
        const dir = rootPackageDir(root);
        return file.startsWith(`${dir}/`);
    });
}
