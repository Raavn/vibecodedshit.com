import path from 'node:path';
import { moduleName } from './roots.js';
/** Logic files with a directory named exactly `domain` anywhere in their path. */
export function isDomainDir(file) {
    return path.posix.dirname(file).split('/').includes('domain');
}
/**
 * Dotted module names of the layers named `domain` in declared `layers` contracts: the last dotted component of the
 * layer is `domain`; entries split on `|` and `:` and are prefixed with each container the contract names.
 */
export function declaredDomainModules(contracts) {
    const out = [];
    for (const contract of contracts) {
        if (contract.type !== 'layers')
            continue;
        for (const line of contract.layers) {
            for (const raw of line.split(/[|:]/)) {
                const layer = raw.trim();
                if (layer === '' || layer.split('.').pop() !== 'domain')
                    continue;
                if (contract.containers.length === 0)
                    out.push(layer);
                else
                    for (const container of contract.containers)
                        out.push(`${container}.${layer}`);
            }
        }
    }
    return out;
}
export function domainFilesOf(logicFiles, roots, declaredModules) {
    return logicFiles.filter((file) => {
        if (isDomainDir(file))
            return true;
        if (declaredModules.length === 0)
            return false;
        const dotted = roots.map((root) => moduleName(root, file)).find((n) => n !== undefined);
        return dotted !== undefined && declaredModules.some((m) => dotted === m || dotted.startsWith(`${m}.`));
    });
}
function inInfrastructure(file, directories) {
    if (isDomainDir(file))
        return false;
    return path.posix.dirname(file).split('/').some((segment) => directories.includes(segment));
}
/**
 * Impure: an import statement (lazy and type-only included) of a forbidden package by its first dotted name, an edge to
 * an in-scope file under an infrastructure directory (unless that file is itself under `domain`), or a builtin `open` call.
 */
export function isImpure(info, importedFiles, lists) {
    const forbidden = new Set(lists.forbiddenImports.python);
    if (info?.imports.some((s) => s.level === 0 && s.modules.some((m) => forbidden.has(m.split('.')[0]))))
        return true;
    if (importedFiles.some((file) => inInfrastructure(file, lists.infrastructureDirectories)))
        return true;
    return info?.opensBuiltin === true;
}
