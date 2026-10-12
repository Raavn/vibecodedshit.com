import { existsSync } from 'node:fs';
import path from 'node:path';
import { analyzePythonDeadCode, type PythonDeadCodeInfo, type PythonSymbol } from '../python/deadcode.js';
import type { ScopedFile } from '../scope/types.js';
import { isOutcome, runKnip } from '../tools/knip.js';
import { failureReason, notFoundReason, unavailable } from '../tools/outcome.js';
import { createWorkCopy } from '../tools/workcopy.js';
import { readToml } from '../util/toml.js';
import { countExportedSymbols } from './ts/exports.js';
import { emptyTallies, logicFiles, tallyUnits, unitId, type Tally } from './units.js';
import type { Measurement, MeasureContext, Measurer } from './types.js';

/** methodology 4.4: vulture min-confidence 60. */
const VULTURE_MIN_CONFIDENCE = '60';
const VULTURE_LINE = /^(.+?):(\d+): unused (function|class|method) '(.+)' \((\d+)% confidence\)$/;

/** Module basenames that are entry points: never reported as unused modules (methodology 4.4). */
const ENTRY_NAMES = new Set([
  '__main__', 'manage', 'wsgi', 'asgi', 'conftest', 'settings',
  'models', 'admin', 'apps', 'urls', 'views', // Django conventions
  'main', // FastAPI
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function pkgDirOf(pkg: string): string {
  return pkg === '.' ? '' : pkg;
}

function joinRel(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}

// ---- TypeScript and JavaScript ----------------------------------------------------------

async function measureTypeScript(ctx: MeasureContext, tallies: Map<string, Tally>, warnings: string[]): Promise<Measurement | null> {
  const files = logicFiles(ctx.scope, 'typescript_javascript');
  if (files.length === 0) return null;
  const knip = await runKnip(ctx);
  if (!isOutcome(knip)) return knip;
  warnings.push(...knip.warnings.map((w) => `4.4: ${w}`));

  const perUnit = new Map<string, { numerator: number; denominator: number }>();
  for (const file of files) {
    const exported = countExportedSymbols(ctx.scope.getTsSourceFile(file.path));
    const issues = knip.files.get(file.path);
    const unused = issues?.unusedFile ? exported : (issues?.exports ?? 0);
    const key = unitId(file);
    const unit = perUnit.get(key) ?? { numerator: 0, denominator: 0 };
    unit.denominator += exported;
    unit.numerator += unused;
    perUnit.set(key, unit);
  }
  for (const [key, unit] of perUnit) {
    const tally = tallies.get(key);
    if (!tally) continue;
    if (unit.numerator > unit.denominator) {
      warnings.push(`4.4: ${tally.package} (${tally.group}): knip reported ${unit.numerator} unused exports for ${unit.denominator} exported symbols, clamped`);
      unit.numerator = unit.denominator;
    }
    tally.numerator += unit.numerator;
    tally.denominator += unit.denominator;
  }
  return null;
}

// ---- Python -----------------------------------------------------------------------------

interface PyModule {
  file: ScopedFile;
  info: Extract<PythonDeadCodeInfo, { ok: true }>;
  /** Every dotted name this file is importable under, over the unit's import roots. */
  names: Set<string>;
}

function importRoots(pkg: string): string[] {
  const dir = pkgDirOf(pkg);
  return [...new Set([dir, joinRel(dir, 'src'), ''])];
}

/** Module parts of `file` under import root `root`, or undefined when the file is not under it. */
function modulePartsUnder(file: string, root: string): string[] | undefined {
  if (root !== '' && !file.startsWith(`${root}/`)) return undefined;
  const rel = root === '' ? file : file.slice(root.length + 1);
  const parts = rel.replace(/\.py$/, '').split('/');
  if (parts[parts.length - 1] === '__init__') parts.pop();
  return parts;
}

function isDistributedPackage(repoPath: string, pkg: string, pyproject: Record<string, unknown> | undefined): boolean {
  if (pyproject && (asRecord(pyproject.project) || asRecord(asRecord(pyproject.tool)?.poetry))) return true;
  const dir = path.join(repoPath, pkgDirOf(pkg));
  return existsSync(path.join(dir, 'setup.py')) || existsSync(path.join(dir, 'setup.cfg'));
}

interface ScriptTargets {
  /** Dotted module names (`api.cli`). */
  modules: Set<string>;
  /** `module:qualname` a script calls (`api.cli:cli`, `api.app:App.run`); vulture sees no caller, so it counts as used. */
  objects: Set<string>;
}

function scriptTargets(pyproject: Record<string, unknown> | undefined): ScriptTargets {
  const targets: ScriptTargets = { modules: new Set(), objects: new Set() };
  const add = (scripts: unknown): void => {
    for (const value of Object.values(asRecord(scripts) ?? {})) {
      const text = typeof value === 'string' ? value : typeof asRecord(value)?.reference === 'string' ? String(asRecord(value)?.reference) : '';
      const [modulePart, objectPart] = text.split(':');
      const module = (modulePart ?? '').trim();
      if (module === '') continue;
      targets.modules.add(module);
      const object = (objectPart ?? '').trim();
      if (object !== '') targets.objects.add(`${module}:${object}`);
    }
  };
  add(asRecord(pyproject?.project)?.scripts);
  add(asRecord(asRecord(pyproject?.tool)?.poetry)?.scripts);
  return targets;
}

function isEntryModule(mod: PyModule, scripts: ScriptTargets): boolean {
  const segments = mod.file.path.replace(/\.py$/, '').split('/');
  const base = segments[segments.length - 1] ?? '';
  if (ENTRY_NAMES.has(base)) return true;
  if (segments.slice(0, -1).includes('settings')) return true;
  return [...mod.names].some((name) => scripts.modules.has(name));
}

/** Imported dotted name to the files that import it. */
function importGraph(modules: PyModule[], tests: PyModule[], pkg: string): Map<string, Set<string>> {
  const importedBy = new Map<string, Set<string>>();
  const mark = (name: string, importer: string): void => {
    if (name === '') return;
    const set = importedBy.get(name) ?? new Set<string>();
    set.add(importer);
    importedBy.set(name, set);
  };
  const markWithParents = (parts: string[], importer: string): void => {
    for (let i = 1; i <= parts.length; i += 1) mark(parts.slice(0, i).join('.'), importer);
  };
  for (const mod of [...modules, ...tests]) {
    for (const root of importRoots(pkg)) {
      const own = modulePartsUnder(mod.file.path, root);
      if (!own) continue;
      const isInit = mod.file.path.endsWith('/__init__.py') || mod.file.path === '__init__.py';
      const ownPackage = isInit ? own : own.slice(0, -1);
      for (const imp of mod.info.imports) {
        const moduleParts = imp.module === '' ? [] : imp.module.split('.');
        let base: string[];
        if (imp.level === 0) {
          base = moduleParts;
        } else {
          const keep = ownPackage.length - (imp.level - 1);
          if (keep < 0) continue;
          base = [...ownPackage.slice(0, keep), ...moduleParts];
        }
        markWithParents(base, mod.file.path);
        if (imp.names.length > 0 && base.length > 0) {
          for (const name of imp.names) mark([...base, name].join('.'), mod.file.path);
        } else if (imp.names.length > 0) {
          for (const name of imp.names) mark(name, mod.file.path);
        }
      }
    }
  }
  return importedBy;
}

function matchSymbol(symbols: PythonSymbol[], name: string, line: number): PythonSymbol | undefined {
  return symbols.find((s) => s.name === name && s.startLine <= line && line <= s.line);
}

async function measurePython(ctx: MeasureContext, tallies: Map<string, Tally>, warnings: string[]): Promise<Measurement | null> {
  const logic = logicFiles(ctx.scope, 'python');
  if (logic.length === 0) return null;
  const tests = ctx.scope.files.filter((f) => f.role === 'test' && f.group === 'python');

  const vulture = await ctx.tools.resolve('vulture');
  if (!vulture) return unavailable(ctx, notFoundReason('vulture'));

  const infos = analyzePythonDeadCode(ctx.repoPath, [...logic, ...tests].map((f) => f.path));
  let unparsed = 0;
  for (const file of [...logic, ...tests]) if (infos[file.path]?.ok !== true) unparsed += 1;
  if (unparsed > 0) warnings.push(`4.4: ${unparsed} Python files could not be parsed`);

  const toModule = (file: ScopedFile): PyModule | undefined => {
    const info = infos[file.path];
    if (!info || !info.ok) return undefined;
    const names = new Set<string>();
    for (const root of importRoots(file.package)) {
      const parts = modulePartsUnder(file.path, root);
      if (parts && parts.length > 0) names.add(parts.join('.'));
    }
    return { file, info, names };
  };

  const packages = [...new Set(logic.map((f) => f.package))];
  for (const pkg of packages) {
    const unitLogic = logic.filter((f) => f.package === pkg).map(toModule).filter((m): m is PyModule => m !== undefined);
    const unitTests = tests.filter((f) => f.package === pkg).map(toModule).filter((m): m is PyModule => m !== undefined);
    const tally = tallies.get(unitId({ package: pkg, group: 'python' }));
    if (!tally || unitLogic.length === 0) continue;

    const pyprojectPath = path.join(ctx.repoPath, joinRel(pkgDirOf(pkg), 'pyproject.toml'));
    const pyproject = readToml(pyprojectPath);
    if (pyproject === undefined && existsSync(pyprojectPath)) {
      warnings.push(`${joinRel(pkgDirOf(pkg), 'pyproject.toml')}: invalid TOML, ignored`);
    }
    const distributed = isDistributedPackage(ctx.repoPath, pkg, pyproject);
    const scripts = scriptTargets(pyproject);

    const importedBy = importGraph(unitLogic, unitTests, pkg);
    const unusedModules = new Set<string>();
    for (const mod of unitLogic) {
      if (isEntryModule(mod, scripts)) continue;
      const used = [...mod.names].some((name) => [...(importedBy.get(name) ?? [])].some((importer) => importer !== mod.file.path));
      if (!used) unusedModules.add(mod.file.path);
    }

    const copy = await createWorkCopy(ctx.repoPath, [...unitLogic, ...unitTests].map((m) => m.file.path));
    let hits: { file: string; line: number; name: string }[];
    try {
      const result = await ctx.tools.run(vulture, ['.', '--min-confidence', VULTURE_MIN_CONFIDENCE], { cwd: copy.dir });
      const failure = failureReason(vulture, result, [0, 3]);
      if (failure) return unavailable(ctx, failure);
      hits = [];
      for (const line of result.stdout.split('\n')) {
        const match = VULTURE_LINE.exec(line.trim());
        if (!match) continue;
        hits.push({
          file: path.posix.normalize((match[1] ?? '').split(path.sep).join('/')).replace(/^\.\//, ''),
          line: Number(match[2]),
          name: match[4] ?? '',
        });
      }
    } finally {
      await copy.cleanup();
    }

    const hitsByFile = new Map<string, typeof hits>();
    for (const hit of hits) hitsByFile.set(hit.file, [...(hitsByFile.get(hit.file) ?? []), hit]);

    for (const mod of unitLogic) {
      tally.denominator += mod.info.symbols.length;
      if (unusedModules.has(mod.file.path)) {
        tally.numerator += mod.info.symbols.length;
        continue;
      }
      const counted = new Set<PythonSymbol>();
      const allNames = new Set(distributed ? (mod.info.allNames ?? []) : []);
      for (const hit of hitsByFile.get(mod.file.path) ?? []) {
        const symbol = matchSymbol(mod.info.symbols, hit.name, hit.line);
        if (!symbol || symbol.decorated || allNames.has(symbol.name)) continue;
        if ([...mod.names].some((name) => scripts.objects.has(`${name}:${symbol.qualname}`))) continue;
        counted.add(symbol);
      }
      tally.numerator += counted.size;
    }
  }
  return null;
}

export const p44: Measurer = {
  id: '4.4',
  layer: 'static',
  async measure(ctx) {
    const tallies = emptyTallies([...logicFiles(ctx.scope, 'typescript_javascript'), ...logicFiles(ctx.scope, 'python')]);
    const warnings: string[] = [];
    const ts = await measureTypeScript(ctx, tallies, warnings);
    if (ts) return ts;
    const py = await measurePython(ctx, tallies, warnings);
    if (py) return py;
    return { status: 'measured', units: tallyUnits(tallies), warnings };
  },
};
