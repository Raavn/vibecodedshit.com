import { checkKinds } from '../scripts/checks.js';
import { ciCommands } from '../scripts/ci.js';
import { expandCommand } from '../scripts/expand.js';
import { dirsUpward } from './ops/entry-points.js';
import { logicUnits } from './units.js';
export const p64 = {
    id: '6.4',
    layer: 'static',
    async measure({ scope, repoPath, methodology }) {
        const warnings = [];
        const commands = ciCommands(repoPath, warnings).filter((c) => c.triggers?.qualifies === true);
        // A command counts for the units at or below its working directory; expand each once.
        const byDir = new Map();
        for (const command of commands) {
            const kinds = byDir.get(command.dir) ?? new Set();
            for (const resolved of expandCommand(repoPath, command.command, { dir: command.dir, file: command.file }, { maxDepth: 3 })) {
                for (const kind of checkKinds(resolved, methodology.d6))
                    kinds.add(kind);
            }
            byDir.set(command.dir, kinds);
        }
        const units = logicUnits(scope).map((unit) => {
            const kinds = new Set();
            for (const dir of dirsUpward(unit.dir))
                for (const kind of byDir.get(dir) ?? [])
                    kinds.add(kind);
            return { package: unit.package, group: unit.group, weight: unit.weight, raw: { kind: 'level', level: String(kinds.size) } };
        });
        return { status: 'measured', units, ...(warnings.length === 0 ? {} : { warnings: warnings.map((w) => `6.4: ${w}`) }) };
    },
};
