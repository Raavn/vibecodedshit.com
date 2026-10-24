import path from 'node:path';
const MANIFEST = {
    typescript_javascript: (base) => base === 'package.json',
    python: (base) => base === 'pyproject.toml' || base === 'Pipfile' || base === 'setup.py' || /^requirements.*\.txt$/.test(base),
};
function isUnder(dir, parent) {
    return parent === '.' || dir === parent || dir.startsWith(`${parent}/`);
}
/**
 * Install roots per language group: the manifest directories that have no manifest directory of the
 * same group above them, so a workspace installs once at its root and a nested example does not
 * need an install of its own. Logic files outside every root go to a root at "." with nothing to install.
 * A root with no logic file of its group beneath it is dropped.
 */
export function planExecution(scope, tracked) {
    const roots = [];
    const typecheck = [];
    for (const group of ['typescript_javascript', 'python']) {
        const files = scope.files.filter((f) => f.group === group && (f.role === 'logic' || f.role === 'test'));
        if (!files.some((f) => f.role === 'logic'))
            continue;
        const manifestDirs = [...new Set(tracked.filter((file) => MANIFEST[group](path.posix.basename(file))).map((file) => path.posix.dirname(file)))];
        const candidates = manifestDirs.filter((dir) => !manifestDirs.some((other) => other !== dir && isUnder(dir, other))).sort();
        const rootOf = (file) => candidates.find((dir) => isUnder(path.posix.dirname(file.path), dir)) ?? '.';
        const byRoot = new Map();
        for (const file of files)
            byRoot.set(rootOf(file), [...(byRoot.get(rootOf(file)) ?? []), file]);
        for (const [dir, groupFiles] of [...byRoot].sort(([a], [b]) => a.localeCompare(b))) {
            const logic = groupFiles.filter((f) => f.role === 'logic');
            if (logic.length === 0)
                continue;
            roots.push({
                dir,
                group,
                weight: logic.reduce((sum, f) => sum + f.logicLines, 0),
                logicFiles: logic.map((f) => f.path),
                sourceFiles: groupFiles.map((f) => f.path),
            });
        }
        const byPackage = new Map();
        for (const file of files)
            byPackage.set(file.package, [...(byPackage.get(file.package) ?? []), file]);
        for (const [dir, unitFiles] of [...byPackage].sort(([a], [b]) => a.localeCompare(b))) {
            if (!unitFiles.some((f) => f.role === 'logic'))
                continue;
            typecheck.push({ dir, group, root: rootOf(unitFiles[0]), sourceFiles: unitFiles.map((f) => f.path) });
        }
    }
    return { roots, typecheck };
}
