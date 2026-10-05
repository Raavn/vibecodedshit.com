import ts from 'typescript';
const hasModifier = (node, kind) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
function bindingNames(name, out) {
    if (ts.isIdentifier(name))
        out.push(name.text);
    else
        for (const el of name.elements)
            if (ts.isBindingElement(el))
                bindingNames(el.name, out);
}
export function summarize(sf) {
    const summary = { defined: new Set(), named: new Map(), stars: [], namespaces: new Map() };
    const imports = new Map();
    for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt) && ts.isStringLiteralLike(stmt.moduleSpecifier) && stmt.importClause) {
            const specifier = stmt.moduleSpecifier.text;
            const clause = stmt.importClause;
            if (clause.name)
                imports.set(clause.name.text, { specifier, orig: 'default' });
            if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                for (const el of clause.namedBindings.elements)
                    imports.set(el.name.text, { specifier, orig: (el.propertyName ?? el.name).text });
            }
        }
    }
    for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
            if (stmt.name)
                summary.defined.add(stmt.name.text);
            if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword))
                summary.defined.add('default');
        }
        else if (ts.isVariableStatement(stmt)) {
            const names = [];
            for (const decl of stmt.declarationList.declarations)
                bindingNames(decl.name, names);
            for (const name of names)
                summary.defined.add(name);
        }
        else if (ts.isExportAssignment(stmt)) {
            summary.defined.add('default');
        }
        else if (ts.isExportDeclaration(stmt)) {
            const from = stmt.moduleSpecifier && ts.isStringLiteralLike(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : undefined;
            const clause = stmt.exportClause;
            if (from !== undefined) {
                if (!clause)
                    summary.stars.push(from);
                else if (ts.isNamespaceExport(clause))
                    summary.namespaces.set(clause.name.text, from);
                else
                    for (const el of clause.elements)
                        summary.named.set(el.name.text, { specifier: from, orig: (el.propertyName ?? el.name).text });
            }
            else if (clause && ts.isNamedExports(clause)) {
                for (const el of clause.elements) {
                    const local = (el.propertyName ?? el.name).text;
                    const imported = imports.get(local);
                    if (imported)
                        summary.named.set(el.name.text, imported);
                    else
                        summary.defined.add(el.name.text);
                }
            }
        }
    }
    return summary;
}
