import ts from 'typescript';
function hasModifier(node, kind) {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);
}
function bindingNames(name, out) {
    if (ts.isIdentifier(name)) {
        out.add(name.text);
        return;
    }
    for (const element of name.elements) {
        if (ts.isBindingElement(element))
            bindingNames(element.name, out);
    }
}
/**
 * Exported symbols of one file, the denominator of 4.4:
 * each exported declaration by name (overloads and merged declarations once, each binding of a
 * destructured `const` once), each specifier of `export { a, b as c }` and `export { x } from`,
 * `export default` once, `export =` once, `export * as ns from` once, `export * from` zero.
 */
export function countExportedSymbols(sourceFile) {
    const names = new Set();
    let extra = 0;
    for (const statement of sourceFile.statements) {
        if (ts.isExportAssignment(statement)) {
            extra += 1; // `export default expr` and `export = expr`
            continue;
        }
        if (ts.isExportDeclaration(statement)) {
            const clause = statement.exportClause;
            if (!clause)
                continue; // export * from '...'
            if (ts.isNamespaceExport(clause))
                extra += 1;
            else
                extra += clause.elements.length;
            continue;
        }
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword))
            continue;
        if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
            extra += 1;
            continue;
        }
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations)
                bindingNames(declaration.name, names);
        }
        else if (ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isEnumDeclaration(statement) ||
            ts.isModuleDeclaration(statement)) {
            if (statement.name)
                names.add(statement.name.getText(sourceFile));
        }
    }
    return names.size + extra;
}
