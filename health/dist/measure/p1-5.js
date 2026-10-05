import { pythonTestFacts } from '../python/tests.js';
import { testCases } from './safety/ts-cases.js';
import { TsCredits } from './safety/ts-credits.js';
import { createTsResolver } from './safety/ts-resolve.js';
import { logicUnits, unitId } from './units.js';
export const p15 = {
    id: '1.5',
    layer: 'static',
    async measure({ scope, repoPath }) {
        const units = logicUnits(scope);
        const tallies = new Map(units.map((u) => [unitId(u), { numerator: 0, denominator: 0 }]));
        const warnings = [];
        const tsTests = scope.files.filter((f) => f.role === 'test' && f.group === 'typescript_javascript' && tallies.has(unitId(f)));
        if (tsTests.length > 0) {
            const credits = new TsCredits(repoPath, scope, createTsResolver(repoPath));
            for (const test of tsTests) {
                const sf = credits.source(test.path);
                const tally = tallies.get(unitId(test));
                if (!sf || !tally)
                    continue;
                for (const found of testCases(sf)) {
                    tally.denominator += 1;
                    if (found.asserts)
                        tally.numerator += 1;
                }
            }
        }
        const pyFiles = scope.files.filter((f) => f.group === 'python');
        const pyTests = pyFiles.filter((f) => f.role === 'test' && tallies.has(unitId(f)));
        if (pyTests.length > 0) {
            const facts = pythonTestFacts(repoPath);
            for (const test of pyTests) {
                const info = facts[test.path];
                const tally = tallies.get(unitId(test));
                if (!tally)
                    continue;
                if (!info?.ok) {
                    warnings.push(`1.5: ${test.path}: syntax error, its test cases are not counted`);
                    continue;
                }
                for (const found of info.cases) {
                    tally.denominator += 1;
                    if (found.asserts)
                        tally.numerator += 1;
                }
            }
        }
        return {
            status: 'measured',
            units: units.map((unit) => ({
                package: unit.package,
                group: unit.group,
                weight: unit.weight,
                raw: { kind: 'ratio', ...tallies.get(unitId(unit)), scale: 100 },
            })),
            ...(warnings.length === 0 ? {} : { warnings }),
        };
    },
};
