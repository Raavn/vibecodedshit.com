import ts from 'typescript';
import type { D6Lists } from '../../methodology/load.js';

const isName = (node: ts.Node, text: string): boolean => ts.isIdentifier(node) && node.text === text;

/** `process.env` */
function isProcessEnv(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node) && isName(node.expression, 'process') && node.name.text === 'env';
}

/** `import.meta.env` */
function isImportMetaEnv(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'env' &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text === 'meta'
  );
}

/**
 * Names read through `process.env.X`, `process.env["X"]`, destructuring from `process.env` (a rest element or computed key is skipped),
 * `import.meta.env.X` and `import.meta.env["X"]`. An alias (`const env = process.env`) and a non-literal key are not counted.
 */
export function tsEnvReads(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && (isProcessEnv(node.expression) || isImportMetaEnv(node.expression))) names.add(node.name.text);
    else if (ts.isElementAccessExpression(node) && (isProcessEnv(node.expression) || isImportMetaEnv(node.expression)) && ts.isStringLiteralLike(node.argumentExpression)) {
      names.add(node.argumentExpression.text);
    } else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isProcessEnv(node.initializer)) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue;
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key)) names.add(key.text);
        else if (ts.isStringLiteralLike(key)) names.add(key.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** True when a name is excluded from 6.5: one of the YAML names, or starting with one of the YAML prefixes. */
export function isExcludedEnvName(name: string, lists: Pick<D6Lists, 'envExcludedNames' | 'envExcludedPrefixes'>): boolean {
  return lists.envExcludedNames.includes(name) || lists.envExcludedPrefixes.some((prefix) => name.startsWith(prefix));
}
