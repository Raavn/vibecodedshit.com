import ts from 'typescript';
const CASE_ROOTS = new Set(['it', 'test']);
const CASE_MODIFIERS = new Set(['only', 'concurrent']);
const EACH_MODIFIERS = new Set(['only', 'concurrent', 'each']);
/** `it`, `test` or `it.only.each` as a root identifier and the property names after it, or undefined for anything else. */
function chainOf(expr) {
    const mods = [];
    let current = expr;
    while (ts.isPropertyAccessExpression(current)) {
        mods.unshift(current.name.text);
        current = current.expression;
    }
    return ts.isIdentifier(current) ? { root: current.text, mods } : undefined;
}
/**
 * A test case is a call to `it` or `test`, or to `it`/`test` followed by a chain of `.only` and `.concurrent`, or `.each(...)` (call or
 * tagged template) and then the call itself. `.skip`, `.todo`, `.fails`, `.skipIf` and `.runIf` are not counted; `describe` is not a case.
 */
function isCaseCall(call) {
    const callee = call.expression;
    const direct = chainOf(callee);
    if (direct)
        return CASE_ROOTS.has(direct.root) && direct.mods.every((m) => CASE_MODIFIERS.has(m));
    const each = ts.isCallExpression(callee) ? callee.expression : ts.isTaggedTemplateExpression(callee) ? callee.tag : undefined;
    const chain = each ? chainOf(each) : undefined;
    return chain !== undefined && CASE_ROOTS.has(chain.root) && chain.mods.at(-1) === 'each' && chain.mods.every((m) => EACH_MODIFIERS.has(m));
}
const isFunctionLike = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
function isAssertionCall(call, testParam) {
    const callee = call.expression;
    if (ts.isIdentifier(callee))
        return ['expect', 'assert', 'expectTypeOf'].includes(callee.text);
    if (!ts.isPropertyAccessExpression(callee))
        return false;
    const props = [];
    let root = callee;
    while (ts.isPropertyAccessExpression(root)) {
        props.unshift(root.name.text);
        root = root.expression;
    }
    if (!ts.isIdentifier(root))
        return false;
    if (root.text === 'expect')
        return props.length === 1 && (props[0] === 'soft' || props[0] === 'poll');
    if (root.text === 'assert')
        return true;
    if (testParam !== undefined && root.text === testParam) {
        const [first] = props;
        return first !== undefined && (first.startsWith('assert') || (props.length === 1 && (first === 'is' || first === 'deepEqual')));
    }
    return false;
}
function containsAssertion(node, testParam, calls) {
    let found = false;
    const visit = (child) => {
        if (found && calls === undefined)
            return;
        if (ts.isCallExpression(child)) {
            if (isAssertionCall(child, testParam))
                found = true;
            calls?.push(child);
        }
        ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
}
/** Functions declared in the file by name: function declarations and `const x = <arrow or function expression>`. */
function helpersOf(sf) {
    const helpers = new Map();
    const visit = (node) => {
        if (ts.isFunctionDeclaration(node) && node.name && node.body)
            helpers.set(node.name.text, node.body);
        else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isFunctionLike(node.initializer))
            helpers.set(node.name.text, node.initializer.body);
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return helpers;
}
/**
 * The test cases of a file. Assertions: `expect(...)`, `expect.soft`, `expect.poll`, `assert(...)`, `assert.*`, `expectTypeOf(...)` and
 * `t.assert*`, `t.is`, `t.deepEqual` where `t` is the callback's first parameter, searched in the whole body. A call to a helper declared in
 * the same file counts when the helper's body directly contains an assertion (one level). A case with no function argument has no assertion.
 */
export function testCases(sf) {
    const helpers = helpersOf(sf);
    const cases = [];
    const visit = (node) => {
        if (ts.isCallExpression(node) && isCaseCall(node)) {
            const callback = [...node.arguments].reverse().find(isFunctionLike);
            let asserts = false;
            if (callback) {
                const first = callback.parameters[0];
                const testParam = first && ts.isIdentifier(first.name) ? first.name.text : undefined;
                const calls = [];
                asserts = containsAssertion(callback.body, testParam, calls);
                if (!asserts) {
                    asserts = calls.some((call) => {
                        const helper = ts.isIdentifier(call.expression) ? helpers.get(call.expression.text) : undefined;
                        return helper !== undefined && containsAssertion(helper, undefined);
                    });
                }
            }
            cases.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, asserts });
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return cases;
}
