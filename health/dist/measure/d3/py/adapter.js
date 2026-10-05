import { pythonDeclaredDeps } from '../../../manifest/python.js';
import { trackedPaths } from '../../../scope/tracked.js';
import { ciInvokes } from '../../../scripts/expand.js';
import { choosePreset } from '../presets.js';
import { findPyDeclared } from './config.js';
import { buildPyGraph } from './graph.js';
import { pythonRoots } from './roots.js';
const GROUP = 'python';
function setup(ctx) {
    return ctx.tools.memo(`d3:py:setup:${ctx.repoPath}`, async () => {
        const warnings = [];
        const tracked = new Set(trackedPaths(ctx.repoPath));
        const byPackage = new Map();
        for (const file of ctx.scope.files) {
            if (file.group !== GROUP)
                continue;
            const list = byPackage.get(file.package) ?? [];
            list.push(file);
            byPackage.set(file.package, list);
        }
        const ciHits = ciInvokes(ctx.repoPath, ['lint-imports'], { warnings });
        const declaredCache = new Map();
        const units = [];
        for (const [pkg, files] of [...byPackage].sort(([a], [b]) => a.localeCompare(b))) {
            const logic = files.filter((f) => f.role === 'logic');
            if (logic.length === 0)
                continue;
            const deps = pythonDeclaredDeps(ctx.repoPath, pkg);
            const preset = choosePreset(ctx.methodology, GROUP, { django: deps.has('django'), fastapi: deps.has('fastapi') });
            const declared = findPyDeclared(ctx.repoPath, pkg, warnings, declaredCache);
            const weight = logic.reduce((sum, f) => sum + f.logicLines, 0);
            const level31 = declared === undefined ? 'none' : ciHits.length > 0 ? 'enforced' : 'declared';
            units.push({
                package: pkg,
                files,
                logic,
                weight,
                preset,
                declared,
                roots: pythonRoots(pkg, files.map((f) => f.path), tracked, warnings),
                rules: {
                    package: pkg,
                    group: GROUP,
                    weight,
                    preset: preset.preset,
                    rulesSource: declared === undefined ? 'preset' : 'declared',
                    ...(declared === undefined ? {} : { rulesFile: declared.file }),
                    level31,
                },
            });
        }
        return { units, warnings };
    });
}
export const pyAdapter = {
    group: GROUP,
    async rules(ctx) {
        const { units, warnings } = await setup(ctx);
        return { units: units.map((u) => u.rules), warnings };
    },
    async graph(ctx) {
        return ctx.tools.memo(`d3:py:graph:${ctx.repoPath}`, async () => {
            const { units } = await setup(ctx);
            return buildPyGraph(ctx, units);
        });
    },
};
