import path from 'node:path';
import { readTracked } from '../../scope/tracked.js';
const MAKEFILE_NAMES = ['Makefile', 'makefile', 'GNUmakefile'];
/** Line based: `name [name...]: [prerequisites]` and tab-indented recipe lines. */
export function parseMakefile(text) {
    const targets = new Map();
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let current = [];
    for (let i = 0; i < lines.length; i += 1) {
        let line = lines[i] ?? '';
        if (line.startsWith('\t')) {
            while (line.endsWith('\\') && i + 1 < lines.length) {
                i += 1;
                line = `${line.slice(0, -1).trimEnd()} ${(lines[i] ?? '').trim()}`;
            }
            const command = line.trim().replace(/^[@\-+]+\s*/, '');
            if (command !== '')
                for (const target of current)
                    target.recipe.push(command);
            continue;
        }
        current = [];
        const match = /^([^\s#:=][^:=#]*?)\s*:(?![:=])\s*([^#]*)/.exec(line);
        if (!match?.[1] || /^(include|-include|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|export|override)\b/.test(line))
            continue;
        const names = match[1].split(/\s+/).filter((n) => n !== '' && !n.includes('%') && !n.includes('$') && n !== '.PHONY');
        const prerequisites = (match[2] ?? '').split(/\s+/).filter((n) => n !== '' && !n.includes('$') && !n.includes('%'));
        for (const name of names) {
            const target = targets.get(name) ?? { prerequisites: [], recipe: [] };
            target.prerequisites.push(...prerequisites);
            targets.set(name, target);
            current.push(target);
        }
    }
    return targets;
}
/** Targets of the Makefile in `dir`. A prerequisite is expanded like a call to `make <prerequisite>`. */
export const makefileEntryPoints = {
    id: 'makefile',
    list(repoPath, dir) {
        const base = dir === '' ? '.' : dir;
        for (const candidate of MAKEFILE_NAMES) {
            const text = readTracked(repoPath, path.posix.join(base, candidate));
            if (text === null)
                continue;
            return [...parseMakefile(text).keys()]
                .filter((name) => !name.startsWith('.') && !name.includes('%'))
                .map((name) => ({ name, invoke: `make ${name}` }));
        }
        return [];
    },
    lookup(repoPath, dir, name) {
        const base = dir === '' ? '.' : dir;
        for (const candidate of MAKEFILE_NAMES) {
            const file = path.posix.join(base, candidate);
            const text = readTracked(repoPath, file);
            if (text === null)
                continue;
            const target = parseMakefile(text).get(name);
            if (!target)
                return undefined;
            return { file, bodies: [...target.prerequisites.map((p) => `make ${p}`), ...target.recipe] };
        }
        return undefined;
    },
};
