import path from 'node:path';
import ts from 'typescript';
import { analyzePythonTyping } from '../python/typing.js';
import { hasLeadingDirective } from './ts/directives.js';
import { unitConfigs } from './ts/tsconfig.js';
import { emptyTallies, logicFiles, unitId } from './units.js';
function hasModifier(node, kind) {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);
}
/** A function or arrow function behind parentheses, `satisfies T` and `as T`. */
function functionOperand(expression) {
    let contextual = false;
    let current = expression;
    for (;;) {
        if (ts.isParenthesizedExpression(current))
            current = current.expression;
        else if (ts.isSatisfiesExpression(current)) {
            contextual = true;
            current = current.expression;
        }
        else if (ts.isAsExpression(current)) {
            if (!(ts.isTypeReferenceNode(current.type) && current.type.getText() === 'const'))
                contextual = true;
            current = current.expression;
        }
        else
            break;
    }
    return ts.isArrowFunction(current) || ts.isFunctionExpression(current) ? { node: current, contextual } : undefined;
}
/** Overload signatures with an implementation count as the implementation; without one, every signature counts. */
function groupOverloads(nodes, keyOf) {
    const byKey = new Map();
    for (const node of nodes) {
        const key = keyOf(node);
        byKey.set(key, [...(byKey.get(key) ?? []), node]);
    }
    return [...byKey.values()].flatMap((group) => {
        const impls = group.filter((n) => n.body !== undefined);
        return impls.length > 0 ? impls : group;
    });
}
function classSurface(node) {
    const candidates = [];
    const setters = [];
    for (const member of node.members) {
        if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member))
            candidates.push(member);
        else if (ts.isSetAccessorDeclaration(member))
            setters.push(member);
        else
            continue;
    }
    const isPublic = (member) => !hasModifier(member, ts.SyntaxKind.PrivateKeyword) &&
        !hasModifier(member, ts.SyntaxKind.ProtectedKeyword) &&
        !(member.name !== undefined && ts.isPrivateIdentifier(member.name));
    const methods = groupOverloads(candidates.filter(isPublic), (m) => `${hasModifier(m, ts.SyntaxKind.StaticKeyword) ? 'static ' : ''}${ts.isConstructorDeclaration(m) ? 'constructor' : m.name.getText()}`);
    return [...methods, ...setters.filter(isPublic)].map((fn) => ({ node: fn, contextual: false }));
}
function isLocalFunctionValue(expression) {
    return expression ? functionOperand(expression) : undefined;
}
/** Functions and function-valued variables declared at the top level of a file, by name. */
function localFunctions(sourceFile) {
    const byName = new Map();
    const declarations = [];
    for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name)
            declarations.push(statement);
        else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (!ts.isIdentifier(declaration.name))
                    continue;
                const surface = isLocalFunctionValue(declaration.initializer);
                if (surface)
                    byName.set(declaration.name.text, [{ ...surface, contextual: surface.contextual || declaration.type !== undefined }]);
            }
        }
    }
    for (const fn of groupOverloads(declarations, (d) => d.name?.text ?? '')) {
        const name = fn.name?.text ?? '';
        byName.set(name, [...(byName.get(name) ?? []), { node: fn, contextual: false }]);
    }
    return byName;
}
function publicSurface(sourceFile) {
    const surface = new Map();
    const add = (items) => {
        for (const item of items)
            surface.set(item.node, item);
    };
    const locals = localFunctions(sourceFile);
    const exportedDeclarations = [];
    for (const statement of sourceFile.statements) {
        const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
        if (ts.isFunctionDeclaration(statement) && exported)
            exportedDeclarations.push(statement);
        else if (ts.isClassDeclaration(statement) && exported)
            add(classSurface(statement));
        else if (ts.isVariableStatement(statement) && exported) {
            for (const declaration of statement.declarationList.declarations) {
                const fn = isLocalFunctionValue(declaration.initializer);
                if (fn)
                    add([{ ...fn, contextual: fn.contextual || declaration.type !== undefined }]);
            }
        }
        else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
            const fn = functionOperand(statement.expression);
            if (fn)
                add([fn]);
            else if (ts.isIdentifier(statement.expression))
                add(locals.get(statement.expression.text) ?? []);
        }
        else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const specifier of statement.exportClause.elements)
                add(locals.get((specifier.propertyName ?? specifier.name).text) ?? []);
        }
        else if (ts.isExpressionStatement(statement)) {
            add(commonJsSurface(statement.expression, locals));
        }
    }
    add(groupOverloads(exportedDeclarations, (d) => d.name?.text ?? 'default').map((node) => ({ node, contextual: false })));
    return [...surface.values()];
}
function commonJsSurface(expression, locals) {
    if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
        return [];
    const left = expression.left;
    const right = expression.right;
    const isModuleExports = (e) => ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'module' && e.name.text === 'exports';
    if (isModuleExports(left)) {
        const fn = functionOperand(right);
        if (fn)
            return [fn];
        if (ts.isClassExpression(right))
            return classSurface(right);
        if (ts.isObjectLiteralExpression(right)) {
            const out = [];
            for (const property of right.properties) {
                if (ts.isMethodDeclaration(property))
                    out.push({ node: property, contextual: false });
                else if (ts.isPropertyAssignment(property)) {
                    const value = functionOperand(property.initializer);
                    if (value)
                        out.push(value);
                }
                else if (ts.isShorthandPropertyAssignment(property))
                    out.push(...(locals.get(property.name.text) ?? []));
            }
            return out;
        }
        return [];
    }
    if (ts.isPropertyAccessExpression(left) &&
        ((ts.isIdentifier(left.expression) && left.expression.text === 'exports') || isModuleExports(left.expression))) {
        const fn = functionOperand(right);
        return fn ? [fn] : [];
    }
    return [];
}
function countTsSlots(sourceFile, checkedAsJs) {
    const slots = { typed: 0, total: 0 };
    for (const { node, contextual } of publicSurface(sourceFile)) {
        for (const parameter of node.parameters) {
            if (ts.isIdentifier(parameter.name) && parameter.name.text === 'this')
                continue;
            slots.total += 1;
            const jsdoc = checkedAsJs && ts.getJSDocParameterTags(parameter).some((tag) => tag.typeExpression !== undefined);
            if (parameter.type !== undefined || parameter.initializer !== undefined || contextual || jsdoc)
                slots.typed += 1;
        }
    }
    return slots;
}
// ---- Python -------------------------------------------------------------------------------
/** Dotted import path parts of a module, with a leading `src` directory ignored. */
function moduleParts(file) {
    const relative = file.package === '.' ? file.path : file.path.slice(file.package.length + 1);
    const parts = relative.split('/');
    if (parts[0] === 'src' && parts.length > 1)
        parts.shift();
    const base = path.posix.basename(relative);
    const stem = base.replace(/\.[^.]+$/, '');
    parts.pop();
    if (stem !== '__init__')
        parts.push(stem);
    return parts;
}
const isPublicName = (name) => !name.startsWith('_');
const isPublicMethod = (name) => !name.startsWith('_') || (name.startsWith('__') && name.endsWith('__') && name.length > 4);
const isOverload = (fn) => fn.decorators.some((d) => d === 'overload' || d.endsWith('.overload'));
/** Overload stubs are skipped when a non-overload definition of the same name exists in the same scope. */
function withoutOverloads(functions) {
    const implemented = new Set(functions.filter((f) => !isOverload(f)).map((f) => f.name));
    return functions.filter((f) => !(isOverload(f) && implemented.has(f.name)));
}
function countFunctionSlots(fn, isMethod, slots) {
    let params = fn.params;
    const isStatic = fn.decorators.includes('staticmethod');
    const first = params[0];
    if (isMethod && (!isStatic || fn.name === '__new__') && first?.kind === 'positional')
        params = params.slice(1);
    for (const param of params) {
        slots.total += 1;
        if (param.typed)
            slots.typed += 1;
    }
    if (fn.name !== '__init__') {
        slots.total += 1;
        if (fn.returns)
            slots.typed += 1;
    }
}
function countPythonSlots(defs, allNames) {
    const slots = { typed: 0, total: 0 };
    const listed = allNames === null ? null : new Set(allNames);
    const isPublicModuleName = (name) => (listed === null ? isPublicName(name) : listed.has(name));
    const functions = withoutOverloads(defs.filter((d) => d.kind === 'function').map((d) => d.info));
    for (const fn of functions)
        if (isPublicModuleName(fn.name))
            countFunctionSlots(fn, false, slots);
    for (const def of defs) {
        if (def.kind !== 'class' || !isPublicModuleName(def.name))
            continue;
        for (const method of withoutOverloads(def.methods))
            if (isPublicMethod(method.name))
                countFunctionSlots(method, true, slots);
    }
    return slots;
}
// ---- Measurer -------------------------------------------------------------------------------
export const p24 = {
    id: '2.4',
    layer: 'static',
    async measure({ scope, repoPath }) {
        const tsFiles = logicFiles(scope, 'typescript_javascript');
        const pyFiles = logicFiles(scope, 'python');
        const tallies = emptyTallies([...tsFiles, ...pyFiles]);
        const cache = new Map();
        const unitConfigsByPackage = new Map();
        const configsFor = (pkg) => {
            const existing = unitConfigsByPackage.get(pkg);
            if (existing)
                return existing;
            const made = unitConfigs(repoPath, pkg, tsFiles.filter((f) => f.package === pkg).map((f) => f.path), cache);
            unitConfigsByPackage.set(pkg, made);
            return made;
        };
        for (const file of tsFiles) {
            const tally = tallies.get(unitId(file));
            if (!tally)
                continue;
            const sourceFile = scope.getTsSourceFile(file.path);
            let checkedAsJs = false;
            if (file.language === 'javascript') {
                const absolute = path.resolve(repoPath, file.path).split(path.sep).join('/');
                const byConfig = configsFor(file.package).configs.some((c) => c.options.checkJs === true && c.fileNames.has(absolute));
                const byComment = hasLeadingDirective(sourceFile, 'ts-check') && !hasLeadingDirective(sourceFile, 'ts-nocheck');
                checkedAsJs = byConfig || byComment;
            }
            const slots = countTsSlots(sourceFile, checkedAsJs);
            tally.numerator += slots.typed;
            tally.denominator += slots.total;
        }
        // Files that cannot be parsed are reported once, by 2.3.
        const info = analyzePythonTyping(repoPath, pyFiles.map((f) => f.path));
        for (const file of pyFiles) {
            const tally = tallies.get(unitId(file));
            const facts = info[file.path];
            if (!tally || !facts?.ok)
                continue;
            if (moduleParts(file).some((part) => part.startsWith('_')))
                continue;
            const slots = countPythonSlots(facts.defs, facts.allNames);
            tally.numerator += slots.typed;
            tally.denominator += slots.total;
        }
        const units = [...tallies.values()]
            .sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group))
            .map((t) => ({
            package: t.package,
            group: t.group,
            weight: t.weight,
            raw: { kind: 'ratio', numerator: t.numerator, denominator: t.denominator, scale: 100 },
        }));
        return { status: 'measured', units };
    },
};
