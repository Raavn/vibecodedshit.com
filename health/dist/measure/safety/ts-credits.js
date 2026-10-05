import { readTracked } from '../../scope/tracked.js';
import { parseTsFile } from '../../scope/ts-lines.js';
import { summarize } from './ts-barrels.js';
import { importFacts, namespaceAccesses } from './ts-imports.js';
/** Logic files of the TS/JS group credited by the imports of one test file, with barrels followed to the defining file. */
export class TsCredits {
    repoPath;
    scope;
    resolver;
    summaries = new Map();
    parsed = new Map();
    constructor(repoPath, scope, resolver) {
        this.repoPath = repoPath;
        this.scope = scope;
        this.resolver = resolver;
    }
    /** A scoped file from the scope's cache; a barrel or other out-of-scope tracked file is parsed from its text. */
    source(file) {
        const cached = this.parsed.get(file);
        if (cached !== undefined)
            return cached ?? undefined;
        let sf = null;
        try {
            sf = this.scope.getTsSourceFile(file);
        }
        catch {
            const text = readTracked(this.repoPath, file);
            sf = text === null ? null : parseTsFile(file, text);
        }
        this.parsed.set(file, sf);
        return sf ?? undefined;
    }
    summary(file) {
        const cached = this.summaries.get(file);
        if (cached !== undefined)
            return cached ?? undefined;
        const sf = this.source(file);
        const summary = sf ? summarize(sf) : null;
        this.summaries.set(file, summary);
        return summary ?? undefined;
    }
    /** The file defining `name` as exported by `start`: breadth first through `export *` sources, first definition wins. */
    define(start, name, seen) {
        const queue = [start];
        while (queue.length > 0) {
            const file = queue.shift();
            const key = `${file}\0${name}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            const summary = this.summary(file);
            if (!summary)
                continue;
            if (summary.defined.has(name))
                return file;
            const named = summary.named.get(name);
            if (named) {
                const target = this.resolver.resolve(named.specifier, file);
                if (target !== undefined)
                    return this.define(target, named.orig, seen) ?? target;
            }
            const namespace = summary.namespaces.get(name);
            if (namespace !== undefined) {
                const target = this.resolver.resolve(namespace, file);
                if (target !== undefined)
                    return target;
            }
            for (const star of summary.stars) {
                const target = this.resolver.resolve(star, file);
                if (target !== undefined)
                    queue.push(target);
            }
        }
        return undefined;
    }
    /** Every file the test file credits (callers keep only logic-role files). */
    credits(test) {
        const out = new Set();
        const sf = this.source(test);
        if (!sf)
            return out;
        const facts = importFacts(sf);
        const namespaces = namespaceAccesses(sf, new Set(facts.flatMap((f) => (f.local === undefined ? [] : [f.local]))));
        for (const fact of facts) {
            const target = this.resolver.resolve(fact.specifier, test);
            if (target === undefined)
                continue;
            if (fact.name === undefined || fact.name === '*') {
                out.add(target);
                for (const name of fact.local === undefined ? [] : [...(namespaces.get(fact.local) ?? [])]) {
                    const defining = this.define(target, name, new Set());
                    if (defining !== undefined)
                        out.add(defining);
                }
            }
            else
                out.add(this.define(target, fact.name, new Set()) ?? target);
        }
        return out;
    }
}
