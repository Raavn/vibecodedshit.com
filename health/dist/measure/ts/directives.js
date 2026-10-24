import ts from 'typescript';
/** True when the file's leading comments hold `@<name>` at the start of a comment (after `//`, `///` or `/*`). */
export function hasLeadingDirective(sourceFile, name) {
    const text = sourceFile.text;
    const pattern = new RegExp(`^(?:\\/\\/\\/?|\\/\\*+)\\s*@${name}\\b`);
    return (ts.getLeadingCommentRanges(text, 0) ?? []).some((range) => pattern.test(text.slice(range.pos, range.end)));
}
const LINE_DIRECTIVE = /^\/\/\/?\s*@(?:ts-expect-error|ts-ignore)/;
const BLOCK_DIRECTIVE = /^(?:\/|\*)*\s*@(?:ts-expect-error|ts-ignore)/;
/** Number of `@ts-ignore` and `@ts-expect-error` comments, found through the AST so strings, templates, regexes and JSX text never count. */
export function countSuppressionComments(sourceFile) {
    const text = sourceFile.text;
    const seen = new Set();
    let count = 0;
    const check = (ranges) => {
        for (const range of ranges ?? []) {
            if (seen.has(range.pos))
                continue;
            seen.add(range.pos);
            const comment = text.slice(range.pos, range.end);
            const matches = range.kind === ts.SyntaxKind.SingleLineCommentTrivia
                ? LINE_DIRECTIVE.test(comment)
                : BLOCK_DIRECTIVE.test(comment.slice(comment.lastIndexOf('\n') + 1));
            if (matches)
                count += 1;
        }
    };
    const visit = (node) => {
        if (node.kind !== ts.SyntaxKind.JsxText) {
            check(ts.getLeadingCommentRanges(text, node.pos));
            check(ts.getTrailingCommentRanges(text, node.end));
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return count;
}
