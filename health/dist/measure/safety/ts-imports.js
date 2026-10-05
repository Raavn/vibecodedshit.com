import ts from 'typescript';
const isStringLiteral = (node) => node !== undefined && ts.isStringLiteralLike(node);
/**
 * What a test file imports: static `import` declarations of every form (`import type` and `import { type X }` included), `export ... from`,
 * `require("<literal>")` and dynamic `import("<literal>")`. `vi.mock`, `jest.mock`, `require.resolve` and non-literal paths do not count.
 */
export function importFacts(sf) {
    const facts = [];
    const visit = (node) => {
        if (ts.isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
            const specifier = node.moduleSpecifier.text;
            const clause = node.importClause;
            if (!clause)
                facts.push({ specifier });
            else {
                if (clause.name)
                    facts.push({ specifier, name: 'default' });
                const bindings = clause.namedBindings;
                if (bindings && ts.isNamespaceImport(bindings))
                    facts.push({ specifier, name: '*', local: bindings.name.text });
                else if (bindings)
                    for (const el of bindings.elements)
                        facts.push({ specifier, name: (el.propertyName ?? el.name).text });
                if (!clause.name && !bindings)
                    facts.push({ specifier });
            }
        }
        else if (ts.isExportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
            const specifier = node.moduleSpecifier.text;
            const clause = node.exportClause;
            if (clause && ts.isNamedExports(clause))
                for (const el of clause.elements)
                    facts.push({ specifier, name: (el.propertyName ?? el.name).text });
            else
                facts.push({ specifier });
        }
        else if (ts.isCallExpression(node) && isStringLiteral(node.arguments[0])) {
            const callee = node.expression;
            if ((ts.isIdentifier(callee) && callee.text === 'require') || callee.kind === ts.SyntaxKind.ImportKeyword) {
                facts.push({ specifier: node.arguments[0].text });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return facts;
}
/** Names accessed as `m.x` for each namespace-import binding `m` of a file. */
export function namespaceAccesses(sf, locals) {
    const out = new Map();
    if (locals.size === 0)
        return out;
    const visit = (node) => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && locals.has(node.expression.text)) {
            const set = out.get(node.expression.text) ?? new Set();
            set.add(node.name.text);
            out.set(node.expression.text, set);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}
