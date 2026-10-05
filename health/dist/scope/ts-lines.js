import ts from 'typescript';
const CALLABLE_KINDS = new Set([
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
function scriptKindFor(file) {
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    if (ext === '.tsx')
        return ts.ScriptKind.TSX;
    if (ext === '.jsx')
        return ts.ScriptKind.JSX;
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs')
        return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}
export function parseTsFile(file, text) {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
}
/**
 * Classify lines using the token stream: a line is code when a token (not trivia)
 * touches it. Multi-line template literals and JSX text are tokens, so their lines
 * are code. Comments, JSDoc and shebangs are trivia.
 */
export function analyzeTsFile(file, text) {
    const sourceFile = parseTsFile(file, text);
    const lineHasToken = new Set();
    let definesCallable = false;
    const visit = (node) => {
        if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)
            return;
        if (CALLABLE_KINDS.has(node.kind))
            definesCallable = true;
        const children = node.getChildren(sourceFile);
        if (children.length === 0) {
            const start = node.getStart(sourceFile);
            const end = node.getEnd();
            if (end > start) {
                const first = sourceFile.getLineAndCharacterOfPosition(start).line;
                const last = sourceFile.getLineAndCharacterOfPosition(end - 1).line;
                for (let line = first; line <= last; line += 1)
                    lineHasToken.add(line);
            }
            return;
        }
        for (const child of children)
            visit(child);
    };
    visit(sourceFile);
    const lines = text.split('\n');
    const codeLineNumbers = new Set();
    for (const line of lineHasToken) {
        if ((lines[line] ?? '').trim() !== '')
            codeLineNumbers.add(line + 1);
    }
    return { sourceFile, definesCallable, codeLines: codeLineNumbers.size, codeLineNumbers };
}
