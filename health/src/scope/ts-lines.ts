import ts from 'typescript';

export interface TsFileInfo {
  sourceFile: ts.SourceFile;
  /** True when the file defines a function, method, constructor, accessor, arrow function or class. */
  definesCallable: boolean;
  /** Non-blank lines that hold at least one token. Comment-only lines are not counted. */
  codeLines: number;
}

const CALLABLE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
]);

function scriptKindFor(file: string): ts.ScriptKind {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function parseTsFile(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
}

/**
 * Classify lines using the token stream: a line is code when a token (not trivia)
 * touches it. Multi-line template literals and JSX text are tokens, so their lines
 * are code. Comments, JSDoc and shebangs are trivia.
 */
export function analyzeTsFile(file: string, text: string): TsFileInfo {
  const sourceFile = parseTsFile(file, text);
  const lineHasToken = new Set<number>();
  let definesCallable = false;

  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (CALLABLE_KINDS.has(node.kind)) definesCallable = true;
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      if (end > start) {
        const first = sourceFile.getLineAndCharacterOfPosition(start).line;
        const last = sourceFile.getLineAndCharacterOfPosition(end - 1).line;
        for (let line = first; line <= last; line += 1) lineHasToken.add(line);
      }
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sourceFile);

  const lines = text.split('\n');
  let codeLines = 0;
  for (const line of lineHasToken) {
    if ((lines[line] ?? '').trim() !== '') codeLines += 1;
  }
  return { sourceFile, definesCallable, codeLines };
}
