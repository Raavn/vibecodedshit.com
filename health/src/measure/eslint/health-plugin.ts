import type { ESLint, Rule } from 'eslint';

/**
 * Reports once for every function node (declarations, expressions, arrows, methods).
 * `sonarjs/cognitive-complexity` registers on the same `:function` selector, so this is the
 * denominator for 4.1: all functions as enumerated by the tool.
 */
const functionRule: Rule.RuleModule = {
  meta: { type: 'problem', schema: [], messages: { fn: 'function' } },
  create(context) {
    return {
      ':function'(node: Rule.Node) {
        context.report({ node, messageId: 'fn' });
      },
    };
  },
};

export const healthPlugin: ESLint.Plugin = {
  meta: { name: 'health' },
  rules: { function: functionRule },
};
