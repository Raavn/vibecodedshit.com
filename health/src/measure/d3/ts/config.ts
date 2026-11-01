import path from 'node:path';
import ts from 'typescript';
import { readTracked, trackedPaths } from '../../../scope/tracked.js';

const CONFIG_NAMES = ['.dependency-cruiser.js', '.dependency-cruiser.cjs', '.dependency-cruiser.mjs', '.dependency-cruiser.json'];

export interface DcPathSpec {
  path?: string | string[];
  pathNot?: string | string[];
}

interface DeclaredRule {
  name: string;
  severity: 'error' | 'warn' | 'info' | 'ignore';
  from: DcPathSpec;
  to: DcPathSpec;
}

export interface DeclaredConfig {
  /** Repo-relative posix path of the rules file. */
  file: string;
  /** Rules that can be evaluated (error or warn), as dependency-cruiser rules. */
  forbidden: DeclaredRule[];
  allowed: Omit<DeclaredRule, 'name' | 'severity'>[] | undefined;
  allowedSeverity: 'error' | 'warn';
  /** At least one forbidden or allowed rule whose from and to paths name different directories. */
  declared: boolean;
}

class NonLiteral extends Error {}

function evalLiteral(node: ts.Node): unknown {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
    return evalLiteral(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isRegularExpressionLiteral(node)) return node.text.replace(/^\/(.*)\/[a-z]*$/s, '$1');
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (ts.isSpreadElement(element)) throw new NonLiteral('spread element');
      return evalLiteral(element);
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) throw new NonLiteral('non-literal property');
      const name = property.name;
      const key = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
      if (key === undefined) throw new NonLiteral('computed property name');
      out[key] = evalLiteral(property.initializer);
    }
    return out;
  }
  throw new NonLiteral(`${ts.SyntaxKind[node.kind]} is not a literal`);
}

/** The object literal a JS config exports: `module.exports = {...}`, `export default {...}` or a top-level const they name. */
function exportedObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  const consts = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) consts.set(declaration.name.text, declaration.initializer);
    }
  }
  const resolve = (expression: ts.Expression): ts.ObjectLiteralExpression | undefined => {
    let current: ts.Expression = expression;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
    if (ts.isObjectLiteralExpression(current)) return current;
    if (ts.isIdentifier(current)) {
      const target = consts.get(current.text);
      return target ? resolve(target) : undefined;
    }
    return undefined;
  };
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) return resolve(statement.expression);
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(statement.expression.left) &&
      ts.isIdentifier(statement.expression.left.expression) &&
      statement.expression.left.expression.text === 'module' &&
      statement.expression.left.name.text === 'exports'
    ) {
      return resolve(statement.expression.right);
    }
  }
  return undefined;
}

/** Elements of an array-literal property, one literal evaluation per element. */
function elementsOf(object: ts.ObjectLiteralExpression, key: string): { node: ts.Expression; value?: unknown; error?: string; name?: string }[] | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    if (!(ts.isIdentifier(name) || ts.isStringLiteral(name)) || name.text !== key) continue;
    let init: ts.Expression = property.initializer;
    while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init)) init = init.expression;
    if (!ts.isArrayLiteralExpression(init)) return [{ node: init, error: `${key} is not an array literal` }];
    return init.elements.map((node) => {
      try {
        if (ts.isSpreadElement(node)) throw new NonLiteral('spread element');
        return { node, value: evalLiteral(node) };
      } catch (err) {
        const name = ts.isObjectLiteralExpression(node) ? scalar(node, 'name') : undefined;
        return { node, error: err instanceof NonLiteral ? err.message : String(err), ...(typeof name === 'string' ? { name } : {}) };
      }
    });
  }
  return undefined;
}

function scalar(object: ts.ObjectLiteralExpression, key: string): unknown {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === key) {
      try {
        return evalLiteral(property.initializer);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const isObj = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function patternList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((v): v is string => typeof v === 'string')) return value;
  return undefined;
}

function pathSpec(value: unknown, label: string): DcPathSpec {
  if (value === undefined) return {};
  if (!isObj(value)) throw new NonLiteral(`${label} is not an object`);
  const spec: DcPathSpec = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== 'path' && key !== 'pathNot') throw new NonLiteral(`${label}.${key} needs an installed project`);
    const list = patternList(entry);
    if (!list) throw new NonLiteral(`${label}.${key} is not a string or list of strings`);
    for (const pattern of list) new RegExp(pattern);
    spec[key] = entry as string | string[];
  }
  return spec;
}

const LITERAL = '(?:[\\w@-]|\\\\\\.)+';
const unescapeLiteral = (text: string): string => text.replace(/\\\./g, '.').replace(/\\\//g, '/');

/** The directories a regex pattern names, or undefined when it does not name any. */
export function directoriesOf(pattern: string): string[] | undefined {
  const anywhere = new RegExp(`\\(\\^\\|\\\\?/\\)(${LITERAL})(?:\\\\?/)`).exec(pattern);
  if (anywhere?.[1]) return [unescapeLiteral(anywhere[1])];
  if (!pattern.startsWith('^')) return undefined;
  const group = new RegExp(`^\\^\\(((?:${LITERAL}(?:\\/${LITERAL})*)(?:\\|(?:${LITERAL}(?:\\/${LITERAL})*))*)\\)((?:\\/${LITERAL})*)(?:\\/|$)`).exec(pattern);
  if (group?.[1]) return group[1].split('|').map((alt) => unescapeLiteral(`${alt}${group[2] ?? ''}`));
  const literal = new RegExp(`^\\^(${LITERAL}(?:\\/${LITERAL})*)(?:\\/|$)`).exec(pattern);
  if (literal?.[1]) return [unescapeLiteral(literal[1])];
  return undefined;
}

function directorySet(value: string | string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const pattern of value === undefined ? [] : Array.isArray(value) ? value : [value]) {
    for (const dir of directoriesOf(pattern) ?? []) set.add(dir);
  }
  return set;
}

/** A direction rule: `from.path` and `to.path` both name directories and the two directory sets differ. */
export function isDirectionRule(rule: { from: DcPathSpec; to: DcPathSpec }): boolean {
  const from = directorySet(rule.from.path);
  const to = directorySet(rule.to.path);
  if (from.size === 0 || to.size === 0) return false;
  return from.size !== to.size || [...from].some((dir) => !to.has(dir));
}

function rawPathSpec(value: unknown): DcPathSpec {
  if (!isObj(value)) return {};
  const spec: DcPathSpec = {};
  for (const key of ['path', 'pathNot'] as const) {
    const list = patternList(value[key]);
    if (list) spec[key] = value[key] as string | string[];
  }
  return spec;
}

const RULE_KEYS = new Set(['name', 'severity', 'comment', 'from', 'to']);

/** Reads one rules file without executing it. Undefined when the file is absent or cannot be read. */
export function readDeclaredConfig(repoPath: string, file: string, warnings: string[] = []): DeclaredConfig | undefined {
  const text = readTracked(repoPath, file);
  if (text === null) return undefined;
  const config: DeclaredConfig = { file, forbidden: [], allowed: undefined, allowedSeverity: 'warn', declared: false };

  type Entry = { value?: unknown; error?: string; name?: string };
  let forbidden: Entry[] | undefined;
  let allowed: Entry[] | undefined;
  let allowedSeverity: unknown;
  try {
    if (file.endsWith('.json')) {
      const doc: unknown = JSON.parse(text);
      if (!isObj(doc)) throw new Error('not an object');
      const wrap = (value: unknown): Entry[] | undefined => (Array.isArray(value) ? value.map((v) => ({ value: v })) : undefined);
      forbidden = wrap(doc.forbidden);
      allowed = wrap(doc.allowed);
      allowedSeverity = doc.allowedSeverity;
      if (doc.options !== undefined || doc.extends !== undefined) warnings.push(`${file}: "options" and "extends" are ignored`);
    } else {
      const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const object = exportedObject(sourceFile);
      if (!object) throw new Error('no module.exports or export default object literal');
      forbidden = elementsOf(object, 'forbidden');
      allowed = elementsOf(object, 'allowed');
      allowedSeverity = scalar(object, 'allowedSeverity');
      if (object.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && (p.name.text === 'options' || p.name.text === 'extends'))) {
        warnings.push(`${file}: "options" and "extends" are ignored`);
      }
    }
  } catch (err) {
    warnings.push(`${file}: could not be read, treated as absent (${err instanceof Error ? err.message : String(err)})`);
    return undefined;
  }

  const ruleName = (value: unknown, index: number, known?: string): string =>
    known ?? (isObj(value) && typeof value.name === 'string' ? value.name : `#${index + 1}`);

  (forbidden ?? []).forEach((entry, index) => {
    if (entry.error !== undefined || !isObj(entry.value)) {
      warnings.push(`${file}: forbidden rule ${ruleName(entry.value, index, entry.name)} skipped (${entry.error ?? 'not an object'})`);
      return;
    }
    const rule = entry.value;
    const raw = { from: rawPathSpec(rule.from), to: rawPathSpec(rule.to) };
    if (isDirectionRule(raw)) config.declared = true;
    try {
      const extra = Object.keys(rule).find((key) => !RULE_KEYS.has(key));
      if (extra !== undefined) throw new NonLiteral(`rule key ${extra} needs an installed project`);
      if (typeof rule.name !== 'string') throw new NonLiteral('rule has no name');
      const severity = rule.severity;
      if (severity !== 'error' && severity !== 'warn' && severity !== 'info' && severity !== 'ignore') throw new NonLiteral('unknown severity');
      const from = pathSpec(rule.from, 'from');
      const to = pathSpec(rule.to, 'to');
      if (severity === 'error' || severity === 'warn') config.forbidden.push({ name: rule.name, severity, from, to });
    } catch (err) {
      warnings.push(`${file}: forbidden rule ${ruleName(rule, index)} skipped (${err instanceof Error ? err.message : String(err)})`);
    }
  });

  if (allowed) {
    const rules: { from: DcPathSpec; to: DcPathSpec }[] = [];
    let complete = true;
    allowed.forEach((entry, index) => {
      if (entry.error !== undefined || !isObj(entry.value)) {
        warnings.push(`${file}: allowed rule ${ruleName(entry.value, index, entry.name)} skipped (${entry.error ?? 'not an object'})`);
        complete = false;
        return;
      }
      const rule = entry.value;
      const raw = { from: rawPathSpec(rule.from), to: rawPathSpec(rule.to) };
      if (isDirectionRule(raw)) config.declared = true;
      try {
        const extra = Object.keys(rule).find((key) => !RULE_KEYS.has(key));
        if (extra !== undefined) throw new NonLiteral(`rule key ${extra} needs an installed project`);
        rules.push({ from: pathSpec(rule.from, 'from'), to: pathSpec(rule.to, 'to') });
      } catch (err) {
        warnings.push(`${file}: allowed rule ${ruleName(rule, index)} skipped (${err instanceof Error ? err.message : String(err)})`);
        complete = false;
      }
    });
    if (!complete) warnings.push(`${file}: the whole "allowed" list is dropped because one of its rules was skipped`);
    const severity = allowedSeverity === undefined ? 'warn' : allowedSeverity;
    if (severity === 'error' || severity === 'warn') config.allowedSeverity = severity;
    if (complete && rules.length > 0 && (severity === 'error' || severity === 'warn')) config.allowed = rules;
  }
  return config;
}

/**
 * The nearest rules file from `packageDir` upwards that declares at least one direction rule.
 * Files that cannot be read, or that declare nothing, are passed over.
 */
export function findDeclaredConfig(repoPath: string, packageDir: string, warnings: string[], cache: Map<string, DeclaredConfig | undefined>): DeclaredConfig | undefined {
  const tracked = new Set(trackedPaths(repoPath));
  for (let dir = path.posix.normalize(packageDir === '' ? '.' : packageDir); ; dir = path.posix.dirname(dir)) {
    for (const name of CONFIG_NAMES) {
      const file = path.posix.join(dir, name);
      if (!tracked.has(file)) continue;
      if (!cache.has(file)) {
        cache.set(file, readDeclaredConfig(repoPath, file, warnings));
      }
      const config = cache.get(file);
      if (config?.declared) return config;
    }
    if (dir === '.' || dir === '') return undefined;
  }
}
