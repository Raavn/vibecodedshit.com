import ts from 'typescript';
import { analyzePythonTyping } from '../python/typing.js';
import { countSuppressionComments, hasLeadingDirective } from './ts/directives.js';
import { emptyTallies, logicFiles, unitId } from './units.js';
const FILE_LEVEL_OPT_OUT = 10;
function isConstType(type) {
    return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'const';
}
/** Escape-hatch points of one TypeScript or JavaScript file (methodology 2.3). */
function countTsEscapeHatches(sourceFile) {
    let points = 0;
    const visit = (node) => {
        switch (node.kind) {
            case ts.SyntaxKind.AnyKeyword:
            case ts.SyntaxKind.NonNullExpression:
                points += 1;
                break;
            case ts.SyntaxKind.AsExpression:
            case ts.SyntaxKind.TypeAssertionExpression:
                if (!isConstType(node.type))
                    points += 1;
                break;
            case ts.SyntaxKind.PropertyDeclaration:
            case ts.SyntaxKind.VariableDeclaration:
                if (node.exclamationToken)
                    points += 1;
                break;
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    points += countSuppressionComments(sourceFile);
    if (hasLeadingDirective(sourceFile, 'ts-nocheck'))
        points += FILE_LEVEL_OPT_OUT;
    return points;
}
export const p23 = {
    id: '2.3',
    layer: 'static',
    async measure({ scope, repoPath }) {
        const tsFiles = logicFiles(scope, 'typescript_javascript');
        const pyFiles = logicFiles(scope, 'python');
        const tallies = emptyTallies([...tsFiles, ...pyFiles]);
        for (const file of tsFiles) {
            const tally = tallies.get(unitId(file));
            if (!tally)
                continue;
            tally.numerator += countTsEscapeHatches(scope.getTsSourceFile(file.path));
            tally.denominator += file.logicLines;
        }
        const warnings = [];
        const info = analyzePythonTyping(repoPath, pyFiles.map((f) => f.path));
        let unparsed = 0;
        for (const file of pyFiles) {
            const tally = tallies.get(unitId(file));
            const facts = info[file.path];
            if (!tally)
                continue;
            if (!facts?.ok) {
                unparsed += 1;
                continue;
            }
            const p = facts.points;
            tally.numerator +=
                p.anyCount + p.castCount + p.typeIgnoreLine + p.pyrightIgnore +
                    FILE_LEVEL_OPT_OUT * (p.typeIgnoreHeader + (p.mypyIgnoreErrors ? 1 : 0));
            tally.denominator += file.logicLines;
        }
        if (unparsed > 0)
            warnings.push(`2.3/2.4: ${unparsed} Python files could not be parsed`);
        const units = [...tallies.values()]
            .sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group))
            .map((t) => ({
            package: t.package,
            group: t.group,
            weight: t.weight,
            raw: { kind: 'ratio', numerator: t.numerator, denominator: t.denominator, scale: 1000 },
        }));
        return { status: 'measured', units, warnings };
    },
};
