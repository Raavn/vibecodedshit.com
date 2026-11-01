import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ESLint } from 'eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';
import { ToolError, type Group, type ScopedFile } from '../scope/types.js';
import { failureReason, unavailable } from '../tools/outcome.js';
import { createWorkCopy } from '../tools/workcopy.js';
import { healthPlugin } from './eslint/health-plugin.js';
import { emptyTallies, logicFiles, tallyUnits, unitId } from './units.js';
import type { Measurement, Measurer } from './types.js';

/** Functions with cognitive complexity strictly greater than this count (methodology 4.1: "strictly greater than 15"). */
const COMPLEXITY_THRESHOLD = 15;

const MESSAGE = /from (\d+) to the 0 allowed/;

interface FileComplexity {
  file: string;
  group: Group;
  /** Every function in the file, as enumerated by the tool. */
  functions: number;
  /** Complexity of every function with complexity above 0. */
  complexities: number[];
}

const require = createRequire(import.meta.url);

function installedVersion(pkg: string): string {
  const json = JSON.parse(readFileSync(require.resolve(`${pkg}/package.json`), 'utf8')) as { version: string };
  return json.version;
}

/** TypeScript and JavaScript: the ESLint Node API with an inline config. No repository code runs, no repository config is read. */
async function lintTypeScript(repoPath: string, files: ScopedFile[]): Promise<{ results: FileComplexity[]; unparsed: number }> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    cwd: repoPath,
    ignore: false,
    overrideConfig: [
      {
        files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
        languageOptions: {
          parser: tseslint.parser,
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { sonarjs, health: healthPlugin },
        rules: { 'sonarjs/cognitive-complexity': ['error', 0], 'health/function': 'error' },
      },
    ],
  });
  const byPath = new Map(files.map((f) => [path.resolve(repoPath, f.path), f]));
  const lint = await eslint.lintFiles([...byPath.keys()]);
  const results: FileComplexity[] = [];
  let unparsed = 0;
  for (const result of lint) {
    const file = byPath.get(path.resolve(result.filePath));
    if (!file) continue;
    if (result.messages.some((m) => m.fatal && m.ruleId === null)) {
      unparsed += 1;
      continue;
    }
    const entry: FileComplexity = { file: file.path, group: file.group, functions: 0, complexities: [] };
    for (const message of result.messages) {
      if (message.ruleId === 'health/function') {
        entry.functions += 1;
      } else if (message.ruleId === 'sonarjs/cognitive-complexity') {
        const match = MESSAGE.exec(message.message);
        if (!match?.[1]) throw new ToolError(`eslint-plugin-sonarjs message not understood: ${message.message}`);
        entry.complexities.push(Number(match[1]));
      }
    }
    results.push(entry);
  }
  return { results, unparsed };
}

interface ComplexipyEntry {
  path?: unknown;
  file_name?: unknown;
  complexity?: unknown;
}

/** complexipy's line for a file it could not parse; the report still holds every other file. */
const UNPARSED = /Failed to process /g;
const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * Python: complexipy in a work copy, so no repository config is read. complexipy exits 1 when any function is over
 * --max-complexity-allowed (--ignore-complexity does not change that, 7.x and 8.x) or a file fails to parse; it still
 * writes the report, so exit 1 is accepted and the report decides.
 */
async function runComplexipy(
  ctx: Parameters<Measurer['measure']>[0],
  files: ScopedFile[],
): Promise<{ results: FileComplexity[]; unparsed: number } | Measurement> {
  const tool = await ctx.tools.resolve('complexipy');
  if (!tool) return unavailable(ctx.tools.notFoundReason('complexipy'));
  const copy = await createWorkCopy(ctx.repoPath, files.map((f) => f.path));
  const outDir = await mkdtemp(path.join(tmpdir(), 'health-complexipy-'));
  try {
    const outFile = path.join(outDir, 'complexipy.json');
    const result = await ctx.tools.run(
      tool,
      ['.', '--max-complexity-allowed', String(COMPLEXITY_THRESHOLD), '--no-ignore', '--ignore-complexity', '--output-format', 'json', '--output', outFile, '--quiet'],
      { cwd: copy.dir },
    );
    const failure = failureReason(tool, result, [0, 1]);
    if (failure) return unavailable(failure);
    let entries: ComplexipyEntry[];
    try {
      entries = JSON.parse(readFileSync(outFile, 'utf8')) as ComplexipyEntry[];
      if (!Array.isArray(entries)) throw new Error('not an array');
    } catch {
      return unavailable('complexipy printed no parseable JSON report');
    }
    const byRel = new Map(files.map((f) => [f.path, f]));
    const perFile = new Map<string, FileComplexity>();
    for (const entry of entries) {
      if (typeof entry.path !== 'string' || typeof entry.complexity !== 'number') {
        return unavailable('complexipy report has an unexpected shape');
      }
      const toRel = (p: string): string => path.relative(copy.dir, path.resolve(copy.dir, p)).split(path.sep).join('/');
      // `path` is the file; if a complexipy release makes it the directory, `file_name` completes it.
      let rel = toRel(entry.path);
      if (!byRel.has(rel) && typeof entry.file_name === 'string') rel = toRel(path.join(entry.path, entry.file_name));
      const file = byRel.get(rel);
      if (!file) continue;
      const item = perFile.get(rel) ?? { file: rel, group: file.group, functions: 0, complexities: [] };
      item.functions += 1;
      if (entry.complexity > 0) item.complexities.push(entry.complexity);
      perFile.set(rel, item);
    }
    const unparsed = `${result.stdout}\n${result.stderr}`.replace(ANSI, '').match(UNPARSED)?.length ?? 0;
    return { results: [...perFile.values()], unparsed };
  } finally {
    await copy.cleanup();
    await rm(outDir, { recursive: true, force: true });
  }
}

export const p41: Measurer = {
  id: '4.1',
  layer: 'static',
  async measure(ctx) {
    const tsFiles = logicFiles(ctx.scope, 'typescript_javascript');
    const pyFiles = logicFiles(ctx.scope, 'python');
    const warnings: string[] = [];
    const perFile: FileComplexity[] = [];
    let unparsed = 0;

    if (tsFiles.length > 0) {
      const ts = await lintTypeScript(ctx.repoPath, tsFiles);
      perFile.push(...ts.results);
      unparsed += ts.unparsed;
      ctx.tools.recordVersion('eslint', installedVersion('eslint'));
      ctx.tools.recordVersion('eslint-plugin-sonarjs', installedVersion('eslint-plugin-sonarjs'));
      ctx.tools.recordVersion('@typescript-eslint/parser', installedVersion('@typescript-eslint/parser'));
    }
    if (pyFiles.length > 0) {
      const py = await runComplexipy(ctx, pyFiles);
      if (!('results' in py)) return py;
      perFile.push(...py.results);
      unparsed += py.unparsed;
    }
    if (unparsed > 0) warnings.push(`4.1: ${unparsed} files could not be parsed`);

    const tallies = emptyTallies([...tsFiles, ...pyFiles]);
    const byPath = new Map([...tsFiles, ...pyFiles].map((f) => [f.path, f]));
    const complexityByFile = [];
    for (const item of perFile.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
      const file = byPath.get(item.file);
      if (!file) continue;
      const tally = tallies.get(unitId(file));
      if (!tally) continue;
      const over = item.complexities.filter((c) => c > COMPLEXITY_THRESHOLD).length;
      tally.denominator += item.functions;
      tally.numerator += over;
      const sum = item.complexities.reduce((a, b) => a + b, 0);
      if (sum > 0) {
        complexityByFile.push({
          file: item.file,
          group: item.group,
          functions: item.functions,
          overThreshold: over,
          complexitySum: sum,
          complexityMax: Math.max(...item.complexities),
        });
      }
    }
    return {
      status: 'measured',
      units: tallyUnits(tallies),
      reportOnly: { complexityByFile },
      warnings,
    };
  },
};
