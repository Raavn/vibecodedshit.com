import ts from 'typescript';

export interface ImportOccurrence {
  /** The specifier text as written. */
  specifier: string;
  kind: 'static' | 'dynamic' | 'require';
  typeOnly: boolean;
  /** Not inside a function, method, accessor or arrow body. */
  topLevel: boolean;
}

const FUNCTION_LIKE = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

const stringOf = (node: ts.Node | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

/** Every import occurrence of a file, read from the TypeScript AST. */
export function classifyImports(sourceFile: ts.SourceFile): ImportOccurrence[] {
  const out: ImportOccurrence[] = [];
  const visit = (node: ts.Node, topLevel: boolean): void => {
    const inside = topLevel && !FUNCTION_LIKE.has(node.kind);
    if (ts.isImportDeclaration(node)) {
      const specifier = stringOf(node.moduleSpecifier);
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const allTypeNamed =
        clause !== undefined &&
        clause.name === undefined &&
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((element) => element.isTypeOnly);
      if (specifier !== undefined) {
        out.push({ specifier, kind: 'static', typeOnly: clause?.isTypeOnly === true || allTypeNamed, topLevel: inside });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = stringOf(node.moduleSpecifier);
      const clause = node.exportClause;
      const allTypeNamed = clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
      if (specifier !== undefined) out.push({ specifier, kind: 'static', typeOnly: node.isTypeOnly || allTypeNamed, topLevel: inside });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = stringOf(node.moduleReference.expression);
      if (specifier !== undefined) out.push({ specifier, kind: 'static', typeOnly: node.isTypeOnly, topLevel: inside });
    } else if (ts.isCallExpression(node)) {
      const specifier = stringOf(node.arguments[0]);
      if (specifier !== undefined) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) out.push({ specifier, kind: 'dynamic', typeOnly: false, topLevel: inside });
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') out.push({ specifier, kind: 'require', typeOnly: false, topLevel: inside });
      }
    } else if (ts.isImportTypeNode(node)) {
      const literal = ts.isLiteralTypeNode(node.argument) ? stringOf(node.argument.literal) : undefined;
      if (literal !== undefined) out.push({ specifier: literal, kind: 'dynamic', typeOnly: true, topLevel: inside });
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(sourceFile, true);
  return out;
}

/** Package name of a specifier: `node:` removed, up to the first `/` (two segments for `@scope/pkg`). */
export function packageName(specifier: string): string {
  const bare = specifier.replace(/^node:/, '');
  const parts = bare.split('/');
  return bare.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? bare);
}

/** True when the file calls the global `fetch`: an unbound identifier call, or `globalThis.fetch(...)`. */
export function callsGlobalFetch(sourceFile: ts.SourceFile): boolean {
  let bound = false;
  let global = false;
  const isFetch = (name: ts.Node | undefined): boolean => name !== undefined && ts.isIdentifier(name) && name.text === 'fetch';
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) &&
      isFetch(node.name)
    ) {
      bound = true;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (isFetch(callee)) global = true;
      else if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch' && ts.isIdentifier(callee.expression) && callee.expression.text === 'globalThis') {
        return void (global = true);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!global) return false;
  if (!bound) return true;
  // A local binding only shadows the identifier form; `globalThis.fetch(...)` still counts.
  let viaGlobalThis = false;
  const again = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'fetch' && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'globalThis') viaGlobalThis = true;
    ts.forEachChild(node, again);
  };
  again(sourceFile);
  return viaGlobalThis;
}

/** The first statement is the directive `"use client"`. */
export function hasUseClient(sourceFile: ts.SourceFile): boolean {
  const first = sourceFile.statements[0];
  return first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client';
}
