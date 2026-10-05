import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ESLint } from 'eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';
import { ToolError } from '../scope/types.js';
import { failureReason, notFoundReason, unavailable } from '../tools/outcome.js';
import { createWorkCopy } from '../tools/workcopy.js';
import { healthPlugin } from './eslint/health-plugin.js';
import { emptyTallies, logicFiles, tallyUnits, unitId } from './units.js';
/** Functions with cognitive complexity strictly greater than this count (methodology 4.1: "strictly greater than 15"). */
export const COMPLEXITY_THRESHOLD = 15;
const MESSAGE = /from (\d+) to the 0 allowed/;
const require = createRequire(import.meta.url);
function installedVersion(pkg) {
    const json = JSON.parse(readFileSync(require.resolve(`${pkg}/package.json`), 'utf8'));
    return json.version;
}
/** TypeScript and JavaScript: the ESLint Node API with an inline config. No repository code runs, no repository config is read. */
async function lintTypeScript(repoPath, files) {
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
    const results = [];
    let unparsed = 0;
    for (const result of lint) {
        const file = byPath.get(path.resolve(result.filePath));
        if (!file)
            continue;
        if (result.messages.some((m) => m.fatal && m.ruleId === null)) {
            unparsed += 1;
            continue;
        }
        const entry = { file: file.path, group: file.group, functions: 0, complexities: [] };
        for (const message of result.messages) {
            if (message.ruleId === 'health/function') {
                entry.functions += 1;
            }
            else if (message.ruleId === 'sonarjs/cognitive-complexity') {
                const match = MESSAGE.exec(message.message);
                if (!match?.[1])
                    throw new ToolError(`eslint-plugin-sonarjs message not understood: ${message.message}`);
                entry.complexities.push(Number(match[1]));
            }
        }
        results.push(entry);
    }
    return { results, unparsed };
}
/** Python: complexipy in a work copy, so no repository config is read. */
async function runComplexipy(ctx, files) {
    const tool = await ctx.tools.resolve('complexipy');
    if (!tool)
        return unavailable(ctx, notFoundReason('complexipy'));
    const copy = await createWorkCopy(ctx.repoPath, files.map((f) => f.path));
    const outDir = await mkdtemp(path.join(tmpdir(), 'health-complexipy-'));
    try {
        const outFile = path.join(outDir, 'complexipy.json');
        const result = await ctx.tools.run(tool, ['.', '--max-complexity-allowed', String(COMPLEXITY_THRESHOLD), '--no-ignore', '--ignore-complexity', '--output-format', 'json', '--output', outFile, '--quiet'], { cwd: copy.dir });
        const failure = failureReason(tool, result, [0]);
        if (failure)
            return unavailable(ctx, failure);
        let entries;
        try {
            entries = JSON.parse(readFileSync(outFile, 'utf8'));
            if (!Array.isArray(entries))
                throw new Error('not an array');
        }
        catch {
            return unavailable(ctx, 'complexipy printed no parseable JSON report');
        }
        const byRel = new Map(files.map((f) => [f.path, f]));
        const perFile = new Map();
        for (const entry of entries) {
            if (typeof entry.path !== 'string' || typeof entry.complexity !== 'number') {
                return unavailable(ctx, 'complexipy report has an unexpected shape');
            }
            const toRel = (p) => path.relative(copy.dir, path.resolve(copy.dir, p)).split(path.sep).join('/');
            // `path` is the file; if a complexipy release makes it the directory, `file_name` completes it.
            let rel = toRel(entry.path);
            if (!byRel.has(rel) && typeof entry.file_name === 'string')
                rel = toRel(path.join(entry.path, entry.file_name));
            const file = byRel.get(rel);
            if (!file)
                continue;
            const item = perFile.get(rel) ?? { file: rel, group: file.group, functions: 0, complexities: [] };
            item.functions += 1;
            if (entry.complexity > 0)
                item.complexities.push(entry.complexity);
            perFile.set(rel, item);
        }
        return [...perFile.values()];
    }
    finally {
        await copy.cleanup();
        await rm(outDir, { recursive: true, force: true });
    }
}
export const p41 = {
    id: '4.1',
    layer: 'static',
    async measure(ctx) {
        const tsFiles = logicFiles(ctx.scope, 'typescript_javascript');
        const pyFiles = logicFiles(ctx.scope, 'python');
        const warnings = [];
        const perFile = [];
        if (tsFiles.length > 0) {
            const { results, unparsed } = await lintTypeScript(ctx.repoPath, tsFiles);
            perFile.push(...results);
            if (unparsed > 0)
                warnings.push(`4.1: ${unparsed} files could not be parsed`);
            ctx.tools.recordVersion('eslint', installedVersion('eslint'));
            ctx.tools.recordVersion('eslint-plugin-sonarjs', installedVersion('eslint-plugin-sonarjs'));
            ctx.tools.recordVersion('@typescript-eslint/parser', installedVersion('@typescript-eslint/parser'));
        }
        if (pyFiles.length > 0) {
            const py = await runComplexipy(ctx, pyFiles);
            if (!Array.isArray(py))
                return py;
            perFile.push(...py);
        }
        const tallies = emptyTallies([...tsFiles, ...pyFiles]);
        const byPath = new Map([...tsFiles, ...pyFiles].map((f) => [f.path, f]));
        const complexityByFile = [];
        for (const item of perFile.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
            const file = byPath.get(item.file);
            if (!file)
                continue;
            const tally = tallies.get(unitId(file));
            if (!tally)
                continue;
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
