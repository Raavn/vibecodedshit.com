import path from 'node:path';
import { pythonTestFacts } from '../../python/tests.js';
import { trackedPaths } from '../../scope/tracked.js';
/** Resolution of Python imports to tracked files, for 1.4. Third-party and stdlib imports resolve to nothing. */
export class PyImportGraph {
    tracked;
    facts;
    packageOf = new Map();
    constructor(repoPath, files) {
        this.tracked = new Set(trackedPaths(repoPath));
        this.facts = pythonTestFacts(repoPath);
        for (const file of files)
            this.packageOf.set(file.path, file.package);
    }
    factsOf(file) {
        return this.facts[file];
    }
    /** The directories an absolute import is tried from, in order: the importer's own directory, `<P>/src`, `<P>`, `src`, `.`. */
    roots(from) {
        const pkg = this.packageOf.get(from) ?? '.';
        const candidates = [path.posix.dirname(from), pkg === '.' ? 'src' : `${pkg}/src`, pkg, 'src', '.'];
        return [...new Set(candidates)];
    }
    moduleIn(dir, parts) {
        const base = parts.length === 0 ? dir : path.posix.join(dir, ...parts);
        for (const candidate of parts.length === 0 ? [path.posix.join(base, '__init__.py')] : [`${base}.py`, path.posix.join(base, '__init__.py')]) {
            if (this.tracked.has(path.posix.normalize(candidate)))
                return path.posix.normalize(candidate);
        }
        return undefined;
    }
    /** The file of `module` as imported from `from` (a relative import uses its `level`; an absolute one tries each root, first hit wins). */
    moduleFile(from, level, module) {
        const parts = module === null ? [] : module.split('.');
        if (level > 0) {
            let dir = path.posix.dirname(from);
            for (let i = 1; i < level; i += 1)
                dir = path.posix.dirname(dir);
            return this.moduleIn(dir, parts);
        }
        if (parts.length === 0)
            return undefined;
        for (const root of this.roots(from)) {
            const found = this.moduleIn(root, parts);
            if (found)
                return found;
        }
        return undefined;
    }
    lookupIn(file, name, seen) {
        const key = `${file}\0${name}`;
        if (seen.has(key))
            return undefined;
        seen.add(key);
        const facts = this.facts[file];
        if (!facts?.ok)
            return undefined;
        if (facts.defined.includes(name))
            return file;
        const binding = facts.reexports.find((r) => r.name === name);
        return binding ? this.fromImport(file, binding.level, binding.module, binding.orig, seen) : undefined;
    }
    /** The file that defines `name` imported by `from <module> import name` in `from`, following `__init__.py` re-exports; a submodule is credited itself. */
    fromImport(from, level, module, name, seen = new Set()) {
        const target = this.moduleFile(from, level, module);
        if (target) {
            const found = this.lookupIn(target, name, seen);
            if (found)
                return found;
        }
        const dir = target === undefined ? (module === null && level > 0 ? this.levelDir(from, level) : undefined) : target.endsWith('/__init__.py') || target === '__init__.py' ? path.posix.dirname(target) : undefined;
        if (dir !== undefined) {
            const sub = this.moduleIn(dir, [name]);
            if (sub)
                return sub;
        }
        return target;
    }
    levelDir(from, level) {
        let dir = path.posix.dirname(from);
        for (let i = 1; i < level; i += 1)
            dir = path.posix.dirname(dir);
        return dir;
    }
    /** Every file a star import of `file` reaches: the module itself and the targets of all its re-export bindings. */
    starTargets(file) {
        const facts = this.facts[file];
        const out = [file];
        if (facts?.ok) {
            for (const binding of facts.reexports) {
                const found = this.fromImport(file, binding.level, binding.module, binding.orig);
                if (found !== undefined)
                    out.push(found);
            }
        }
        return out;
    }
    /** The files a test file credits through its imports. */
    credits(test) {
        const facts = this.facts[test];
        if (!facts?.ok)
            return [];
        const out = [];
        for (const imp of facts.imports) {
            if (imp.names.length === 0 && !imp.star) {
                const file = this.moduleFile(test, imp.level, imp.module);
                if (file !== undefined)
                    out.push(file);
                continue;
            }
            for (const { name } of imp.names) {
                const found = this.fromImport(test, imp.level, imp.module, name);
                if (found !== undefined)
                    out.push(found);
            }
            if (imp.star) {
                const file = this.moduleFile(test, imp.level, imp.module);
                if (file !== undefined)
                    out.push(...this.starTargets(file));
            }
        }
        return out;
    }
}
