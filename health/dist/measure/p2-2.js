import path from 'node:path';
import { pythonLevel } from './py/typecheck-config.js';
import { levelOf, lowestLevel, unitConfigs } from './ts/tsconfig.js';
import { emptyTallies, logicFiles } from './units.js';
const TS_SOURCE = /\.(?:ts|tsx|mts|cts)$/i;
export const p22 = {
    id: '2.2',
    layer: 'static',
    async measure({ scope, repoPath }) {
        const warnings = [];
        const cache = new Map();
        const warned = new Set();
        const units = [];
        const tsFiles = logicFiles(scope, 'typescript_javascript');
        for (const tally of emptyTallies(tsFiles).values()) {
            const unitFiles = tsFiles.filter((f) => f.package === tally.package).map((f) => f.path);
            const { configs, read } = unitConfigs(repoPath, tally.package, unitFiles, cache);
            for (const config of read) {
                for (const missing of config.missingExtends) {
                    const message = `2.2: ${path.posix.relative(repoPath.split(path.sep).join('/'), config.file)} extends ${missing}, which could not be resolved; level computed without it`;
                    if (!warned.has(message)) {
                        warned.add(message);
                        warnings.push(message);
                    }
                }
            }
            const hasTypeScript = unitFiles.some((f) => TS_SOURCE.test(f));
            const levels = configs.map((c) => (!hasTypeScript && c.options.checkJs !== true ? 'none' : levelOf(c.options)));
            const level = levels.length === 0 ? 'none' : lowestLevel(levels);
            units.push({ package: tally.package, group: tally.group, weight: tally.weight, raw: { kind: 'level', level } });
        }
        const pyFiles = logicFiles(scope, 'python');
        for (const tally of emptyTallies(pyFiles).values()) {
            units.push({
                package: tally.package,
                group: tally.group,
                weight: tally.weight,
                raw: { kind: 'level', level: pythonLevel(repoPath, tally.package, warnings) },
            });
        }
        units.sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group));
        return { status: 'measured', units, warnings: [...new Set(warnings)] };
    },
};
