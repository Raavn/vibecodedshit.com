import { EntryPointChecks } from './ops/entry-points.js';
import { logicUnits } from './units.js';
export const p62 = {
    id: '6.2',
    layer: 'static',
    async measure({ scope, repoPath, methodology }) {
        const checks = new EntryPointChecks(repoPath, methodology.d6);
        const findings = new Set();
        const units = logicUnits(scope).map((unit) => {
            const candidates = checks.forUnit(unit.dir);
            for (const entry of candidates) {
                if (entry.unrecognised.length > 0)
                    findings.add(`6.2: ${entry.name} calls ${entry.unrecognised.join(', ')}, which is not a recognised tool`);
            }
            const level = Math.max(0, ...candidates.map((c) => c.kinds.size));
            return { package: unit.package, group: unit.group, weight: unit.weight, raw: { kind: 'level', level: String(level) } };
        });
        return { status: 'measured', units, ...(findings.size === 0 ? {} : { warnings: [...findings].sort() }) };
    },
};
