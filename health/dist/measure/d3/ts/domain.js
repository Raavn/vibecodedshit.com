import path from 'node:path';
import { callsGlobalFetch, classifyImports, packageName } from './classify.js';
/** Logic files with a directory named exactly `domain` anywhere in their path. */
export function isDomainFile(file) {
    return path.posix.dirname(file).split('/').includes('domain');
}
function inInfrastructure(file, directories) {
    if (isDomainFile(file))
        return false;
    return path.posix.dirname(file).split('/').some((segment) => directories.includes(segment));
}
/**
 * A domain file is impure when it imports a forbidden package (type-only included), imports an in-scope
 * file under an infrastructure directory (unless that file is itself under `domain`), or calls the global `fetch`.
 */
export function isImpure(sourceFile, importedFiles, lists) {
    const forbidden = new Set(lists.forbiddenImports.typescript_javascript);
    if (classifyImports(sourceFile).some((occurrence) => forbidden.has(packageName(occurrence.specifier))))
        return true;
    if (importedFiles.some((file) => inInfrastructure(file, lists.infrastructureDirectories)))
        return true;
    return callsGlobalFetch(sourceFile);
}
