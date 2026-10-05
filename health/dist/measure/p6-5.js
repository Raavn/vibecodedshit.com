import path from 'node:path';
import { pythonEnvReads } from '../python/env.js';
import { readTracked } from '../scope/tracked.js';
import { dirsUpward } from './ops/entry-points.js';
import { parseEnvExample } from './ops/env-example.js';
import { isExcludedEnvName, tsEnvReads } from './ops/env-reads.js';
import { runtimePinned } from './ops/runtime.js';
import { logicUnits } from './units.js';
export const p65 = {
    id: '6.5',
    layer: 'static',
    async measure({ scope, repoPath, methodology }) {
        const lists = methodology.d6;
        const warnings = [];
        const pyFiles = scope.files.filter((f) => f.group === 'python' && f.role === 'logic').map((f) => f.path);
        const pyReads = pyFiles.length === 0 ? {} : pythonEnvReads(repoPath, pyFiles);
        const units = logicUnits(scope).map((unit) => {
            const read = new Set();
            for (const file of unit.files) {
                if (unit.group === 'python') {
                    const found = pyReads[file.path];
                    if (found?.ok)
                        for (const name of found.names)
                            read.add(name);
                    else
                        warnings.push(`6.5: ${file.path}: syntax error, its environment reads are not counted`);
                }
                else
                    for (const name of tsEnvReads(scope.getTsSourceFile(file.path)))
                        read.add(name);
            }
            const names = [...read].filter((name) => !isExcludedEnvName(name, lists));
            let documented = new Set();
            search: for (const dir of dirsUpward(unit.dir)) {
                for (const name of lists.envExampleFiles) {
                    const text = readTracked(repoPath, path.posix.join(dir, name));
                    if (text !== null) {
                        documented = new Set(Object.keys(parseEnvExample(text)));
                        break search;
                    }
                }
            }
            const numerator = names.filter((name) => documented.has(name)).length;
            const pinned = runtimePinned(repoPath, unit.dir, unit.group, lists.runtimePinFiles, warnings);
            return {
                package: unit.package,
                group: unit.group,
                weight: unit.weight,
                raw: {
                    kind: 'components',
                    components: {
                        runtime_pinned: { kind: 'level', level: pinned ? 'yes' : 'no' },
                        env_documented: { kind: 'ratio', numerator, denominator: names.length, scale: 100, ...(names.length === 0 ? { emptyScore: 100 } : {}) },
                    },
                },
            };
        });
        return { status: 'measured', units, ...(warnings.length === 0 ? {} : { warnings: [...new Set(warnings)] }) };
    },
};
