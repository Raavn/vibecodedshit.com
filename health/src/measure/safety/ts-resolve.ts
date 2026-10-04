import path from 'node:path';
import ts from 'typescript';
import { trackedPaths } from '../../scope/tracked.js';
import { compilerOptionsFor } from '../ts/tsconfig.js';

export interface TsResolver {
  /** The repo-relative tracked file a specifier resolves to from `fromFile`, or undefined (a package import, a missing file). */
  resolve(specifier: string, fromFile: string): string | undefined;
}

const posix = (p: string): string => p.split(path.sep).join('/');

/**
 * `ts.resolveModuleName` with the options of the nearest tsconfig and a host backed by the tracked files, so `node_modules`
 * is never read and a package import resolves to nothing. NodeNext `.js` specifiers that map to `.ts` files resolve through the compiler.
 */
export function createTsResolver(repoPath: string): TsResolver {
  const root = posix(path.resolve(repoPath));
  const files = new Set(trackedPaths(repoPath));
  const dirs = new Set<string>(['']);
  for (const file of files) for (let d = path.posix.dirname(file); d !== '.' && !dirs.has(d); d = path.posix.dirname(d)) dirs.add(d);
  const rel = (abs: string): string => path.posix.relative(root, posix(abs));
  const host: ts.ModuleResolutionHost = {
    fileExists: (abs) => files.has(rel(abs)),
    readFile: (abs) => (files.has(rel(abs)) ? ts.sys.readFile(abs) : undefined),
    directoryExists: (abs) => dirs.has(rel(abs) === '.' ? '' : rel(abs)),
    realpath: (abs) => abs,
    getCurrentDirectory: () => root,
    useCaseSensitiveFileNames: true,
  };
  const optionsByDir = new Map<string, ts.CompilerOptions>();
  return {
    resolve(specifier, fromFile) {
      const dir = path.posix.dirname(fromFile);
      let options = optionsByDir.get(dir);
      if (!options) {
        options = compilerOptionsFor(repoPath, dir);
        optionsByDir.set(dir, options);
      }
      const containing = path.posix.join(root, fromFile);
      const result = ts.resolveModuleName(specifier, containing, options, host).resolvedModule;
      if (!result) return undefined;
      const found = rel(result.resolvedFileName);
      return found.startsWith('..') || !files.has(found) ? undefined : found;
    },
  };
}
