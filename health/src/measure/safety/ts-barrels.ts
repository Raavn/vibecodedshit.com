import ts from 'typescript';

/** What a module defines and re-exports, for following an imported name to the file that defines it. */
export interface ModuleSummary {
  defined: Set<string>;
  /** `export { orig as name } from spec`, `export { default as name } from spec` and `import { a } from spec; export { a }`. */
  named: Map<string, { specifier: string; orig: string }>;
  /** `export * from spec`, in source order. */
  stars: string[];
  /** `export * as name from spec`. */
  namespaces: Map<string, string>;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
}

export function summarize(sf: ts.SourceFile): ModuleSummary {
  const summary: ModuleSummary = { defined: new Set(), named: new Map(), stars: [], namespaces: new Map() };
  const imports = new Map<string, { specifier: string; orig: string }>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteralLike(stmt.moduleSpecifier) && stmt.importClause) {
      const specifier = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (clause.name) imports.set(clause.name.text, { specifier, orig: 'default' });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) imports.set(el.name.text, { specifier, orig: (el.propertyName ?? el.name).text });
      }
    }
  }
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      if (stmt.name) summary.defined.add(stmt.name.text);
      if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) summary.defined.add('default');
    } else if (ts.isVariableStatement(stmt)) {
      const names: string[] = [];
      for (const decl of stmt.declarationList.declarations) bindingNames(decl.name, names);
      for (const name of names) summary.defined.add(name);
    } else if (ts.isExportAssignment(stmt)) {
      summary.defined.add('default');
    } else if (ts.isExportDeclaration(stmt)) {
      const from = stmt.moduleSpecifier && ts.isStringLiteralLike(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : undefined;
      const clause = stmt.exportClause;
      if (from !== undefined) {
        if (!clause) summary.stars.push(from);
        else if (ts.isNamespaceExport(clause)) summary.namespaces.set(clause.name.text, from);
        else for (const el of clause.elements) summary.named.set(el.name.text, { specifier: from, orig: (el.propertyName ?? el.name).text });
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          const local = (el.propertyName ?? el.name).text;
          const imported = imports.get(local);
          if (imported) summary.named.set(el.name.text, imported);
          else summary.defined.add(el.name.text);
        }
      }
    }
  }
  return summary;
}
