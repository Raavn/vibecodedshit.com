/**
 * Reports once for every function node (declarations, expressions, arrows, methods).
 * `sonarjs/cognitive-complexity` registers on the same `:function` selector, so this is the
 * denominator for 4.1: all functions as enumerated by the tool.
 */
const functionRule = {
    meta: { type: 'problem', schema: [], messages: { fn: 'function' } },
    create(context) {
        return {
            ':function'(node) {
                context.report({ node, messageId: 'fn' });
            },
        };
    },
};
export const healthPlugin = {
    meta: { name: 'health' },
    rules: { function: functionRule },
};
