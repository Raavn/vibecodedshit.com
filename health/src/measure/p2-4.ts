import path from 'node:path';
import ts from 'typescript';
import { analyzePythonTyping, type PythonDef, type PythonFunction } from '../python/typing.js';
import type { ScopedFile } from '../scope/types.js';
import { hasLeadingDirective } from './ts/directives.js';
import { unitConfigs, type ConfigCache } from './ts/tsconfig.js';
import { emptyTallies, logicFiles, unitId, type Tally } from './units.js';
import type { Measurer, UnitRaw } from './types.js';

interface Slots {
  typed: number;
  total: number;
}

// ---- TypeScript and JavaScript ----------------------------------------------------------

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration | ts.SetAccessorDeclaration;

interface Surface {
  node: FunctionLike;
  /** The function gets its type from an annotation, `satisfies` or `as` around it. */
  contextual: boolean;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);
}

/** A function or arrow function behind parentheses, `satisfies T` and `as T`. */
function functionOperand(expression: ts.Expression): Surface | undefined {
  let contextual = false;
  let current: ts.Expression = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) current = current.expression;
    else if (ts.isSatisfiesExpression(current)) {
      contextual = true;
      current = current.expression;
    } else if (ts.isAsExpression(current)) {
      if (!(ts.isTypeReferenceNode(current.type) && current.type.getText() === 'const')) contextual = true;
      current = current.expression;
    } else break;
  }
  return ts.isArrowFunction(current) || ts.isFunctionExpression(current) ? { node: current, contextual } : undefined;
}

/** Overload signatures with an implementation count as the implementation; without one, every signature counts. */
function groupOverloads<T extends ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration>(nodes: T[], keyOf: (n: T) => string): T[] {
  const byKey = new Map<string, T[]>();
  for (const node of nodes) {
    const key = keyOf(node);
    byKey.set(key, [...(byKey.get(key) ?? []), node]);
  }
  return [...byKey.values()].flatMap((group) => {
    const impls = group.filter((n) => n.body !== undefined);
    return impls.length > 0 ? impls : group;
  });
}

function classSurface(node: ts.ClassLikeDeclaration | ts.ClassExpression): Surface[] {
  const candidates: (ts.MethodDeclaration | ts.ConstructorDeclaration)[] = [];
  const setters: ts.SetAccessorDeclaration[] = [];
  for (const member of node.members) {
    if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) candidates.push(member);
    else if (ts.isSetAccessorDeclaration(member)) setters.push(member);
    else continue;
  }
  const isPublic = (member: ts.ClassElement): boolean =>
    !hasModifier(member, ts.SyntaxKind.PrivateKeyword) &&
    !hasModifier(member, ts.SyntaxKind.ProtectedKeyword) &&
    !(member.name !== undefined && ts.isPrivateIdentifier(member.name));
  const methods = groupOverloads(candidates.filter(isPublic), (m) =>
    `${hasModifier(m, ts.SyntaxKind.StaticKeyword) ? 'static ' : ''}${ts.isConstructorDeclaration(m) ? 'constructor' : m.name.getText()}`,
  );
  return [...methods, ...setters.filter(isPublic)].map((fn) => ({ node: fn, contextual: false }));
}

function isLocalFunctionValue(expression: ts.Expression | undefined): Surface | undefined {
  return expression ? functionOperand(expression) : undefined;
}

/** Functions and function-valued variables declared at the top level of a file, by name. */
function localFunctions(sourceFile: ts.SourceFile): Map<string, Surface[]> {
  const byName = new Map<string, Surface[]>();
  const declarations: ts.FunctionDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.push(statement);
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const surface = isLocalFunctionValue(declaration.initializer);
        if (surface) byName.set(declaration.name.text, [{ ...surface, contextual: surface.contextual || declaration.type !== undefined }]);
      }
    }
  }
  for (const fn of groupOverloads(declarations, (d) => d.name?.text ?? '')) {
    const name = fn.name?.text ?? '';
    byName.set(name, [...(byName.get(name) ?? []), { node: fn, contextual: false }]);
  }
  return byName;
}

function publicSurface(sourceFile: ts.SourceFile): Surface[] {
  const surface = new Map<ts.Node, Surface>();
  const add = (items: Surface[]): void => {
    for (const item of items) surface.set(item.node, item);
  };
  const locals = localFunctions(sourceFile);
  const exportedDeclarations: ts.FunctionDeclaration[] = [];

  for (const statement of sourceFile.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && exported) exportedDeclarations.push(statement);
    else if (ts.isClassDeclaration(statement) && exported) add(classSurface(statement));
    else if (ts.isVariableStatement(statement) && exported) {
      for (const declaration of statement.declarationList.declarations) {
        const fn = isLocalFunctionValue(declaration.initializer);
        if (fn) add([{ ...fn, contextual: fn.contextual || declaration.type !== undefined }]);
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const fn = functionOperand(statement.expression);
      if (fn) add([fn]);
      else if (ts.isIdentifier(statement.expression)) add(locals.get(statement.expression.text) ?? []);
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) add(locals.get((specifier.propertyName ?? specifier.name).text) ?? []);
    } else if (ts.isExpressionStatement(statement)) {
      add(commonJsSurface(statement.expression, locals));
    }
  }
  add(groupOverloads(exportedDeclarations, (d) => d.name?.text ?? 'default').map((node) => ({ node, contextual: false })));
  return [...surface.values()];
}

function commonJsSurface(expression: ts.Expression, locals: Map<string, Surface[]>): Surface[] {
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return [];
  const left = expression.left;
  const right = expression.right;
  const isModuleExports = (e: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'module' && e.name.text === 'exports';
  if (isModuleExports(left)) {
    const fn = functionOperand(right);
    if (fn) return [fn];
    if (ts.isClassExpression(right)) return classSurface(right);
    if (ts.isObjectLiteralExpression(right)) {
      const out: Surface[] = [];
      for (const property of right.properties) {
        if (ts.isMethodDeclaration(property)) out.push({ node: property, contextual: false });
        else if (ts.isPropertyAssignment(property)) {
          const value = functionOperand(property.initializer);
          if (value) out.push(value);
        } else if (ts.isShorthandPropertyAssignment(property)) out.push(...(locals.get(property.name.text) ?? []));
      }
      return out;
    }
    return [];
  }
  if (
    ts.isPropertyAccessExpression(left) &&
    ((ts.isIdentifier(left.expression) && left.expression.text === 'exports') || isModuleExports(left.expression))
  ) {
    const fn = functionOperand(right);
    return fn ? [fn] : [];
  }
  return [];
}

function countTsSlots(sourceFile: ts.SourceFile, checkedAsJs: boolean): Slots {
  const slots: Slots = { typed: 0, total: 0 };
  for (const { node, contextual } of publicSurface(sourceFile)) {
    for (const parameter of node.parameters) {
      if (ts.isIdentifier(parameter.name) && parameter.name.text === 'this') continue;
      slots.total += 1;
      const jsdoc = checkedAsJs && ts.getJSDocParameterTags(parameter).some((tag) => tag.typeExpression !== undefined);
      if (parameter.type !== undefined || parameter.initializer !== undefined || contextual || jsdoc) slots.typed += 1;
    }
  }
  return slots;
}

// ---- Python -------------------------------------------------------------------------------

/** Dotted import path parts of a module, with a leading `src` directory ignored. */
function moduleParts(file: ScopedFile): string[] {
  const relative = file.package === '.' ? file.path : file.path.slice(file.package.length + 1);
  const parts = relative.split('/');
  if (parts[0] === 'src' && parts.length > 1) parts.shift();
  const base = path.posix.basename(relative);
  const stem = base.replace(/\.[^.]+$/, '');
  parts.pop();
  if (stem !== '__init__') parts.push(stem);
  return parts;
}

const isPublicName = (name: string): boolean => !name.startsWith('_');
const isPublicMethod = (name: string): boolean => !name.startsWith('_') || (name.startsWith('__') && name.endsWith('__') && name.length > 4);
const isOverload = (fn: PythonFunction): boolean => fn.decorators.some((d) => d === 'overload' || d.endsWith('.overload'));

/** Overload stubs are skipped when a non-overload definition of the same name exists in the same scope. */
function withoutOverloads(functions: PythonFunction[]): PythonFunction[] {
  const implemented = new Set(functions.filter((f) => !isOverload(f)).map((f) => f.name));
  return functions.filter((f) => !(isOverload(f) && implemented.has(f.name)));
}

function countFunctionSlots(fn: PythonFunction, isMethod: boolean, slots: Slots): void {
  let params = fn.params;
  const isStatic = fn.decorators.includes('staticmethod');
  const first = params[0];
  if (isMethod && (!isStatic || fn.name === '__new__') && first?.kind === 'positional') params = params.slice(1);
  for (const param of params) {
    slots.total += 1;
    if (param.typed) slots.typed += 1;
  }
  if (fn.name !== '__init__') {
    slots.total += 1;
    if (fn.returns) slots.typed += 1;
  }
}

function countPythonSlots(defs: PythonDef[], allNames: string[] | null): Slots {
  const slots: Slots = { typed: 0, total: 0 };
  const listed = allNames === null ? null : new Set(allNames);
  const isPublicModuleName = (name: string): boolean => (listed === null ? isPublicName(name) : listed.has(name));

  const functions = withoutOverloads(defs.filter((d) => d.kind === 'function').map((d) => (d as { info: PythonFunction }).info));
  for (const fn of functions) if (isPublicModuleName(fn.name)) countFunctionSlots(fn, false, slots);
  for (const def of defs) {
    if (def.kind !== 'class' || !isPublicModuleName(def.name)) continue;
    for (const method of withoutOverloads(def.methods)) if (isPublicMethod(method.name)) countFunctionSlots(method, true, slots);
  }
  return slots;
}

// ---- Measurer -------------------------------------------------------------------------------

export const p24: Measurer = {
  id: '2.4',
  layer: 'static',
  async measure({ scope, repoPath }) {
    const tsFiles = logicFiles(scope, 'typescript_javascript');
    const pyFiles = logicFiles(scope, 'python');
    const tallies: Map<string, Tally> = emptyTallies([...tsFiles, ...pyFiles]);
    const cache: ConfigCache = new Map();
    const unitConfigsByPackage = new Map<string, ReturnType<typeof unitConfigs>>();
    const configsFor = (pkg: string): ReturnType<typeof unitConfigs> => {
      const existing = unitConfigsByPackage.get(pkg);
      if (existing) return existing;
      const made = unitConfigs(repoPath, pkg, tsFiles.filter((f) => f.package === pkg).map((f) => f.path), cache);
      unitConfigsByPackage.set(pkg, made);
      return made;
    };

    for (const file of tsFiles) {
      const tally = tallies.get(unitId(file));
      if (!tally) continue;
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
      if (!tally || !facts?.ok) continue;
      if (moduleParts(file).some((part) => part.startsWith('_'))) continue;
      const slots = countPythonSlots(facts.defs, facts.allNames);
      tally.numerator += slots.typed;
      tally.denominator += slots.total;
    }

    const units: UnitRaw[] = [...tallies.values()]
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
