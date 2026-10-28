import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { failureReason, unavailable } from '../tools/outcome.js';
import { createWorkCopy } from '../tools/workcopy.js';
import { emptyTallies, logicFiles, tallyUnits, unitId } from './units.js';
/** Methodology 4.3: min-tokens 50, min-lines 5. */
const MIN_TOKENS = '50';
const MIN_LINES = '5';
/** Physical lines the way jscpd counts them: a trailing newline does not start another line. */
function physicalLines(text) {
    if (text === '')
        return 0;
    const lines = text.split(/\r\n|\r|\n/);
    return text.endsWith('\n') || text.endsWith('\r') ? lines.length - 1 : lines.length;
}
function isRange(fragment) {
    return !!fragment && typeof fragment.name === 'string' && typeof fragment.start === 'number' && typeof fragment.end === 'number';
}
/**
 * Duplicated lines per file, the way jscpd's `duplicatedLines` counts them: each clone once, with the
 * lines of the fragment it is attributed to. A clone belongs to its firstFile, or to its secondFile when
 * firstFile is out of scope; a clone with neither file in scope is dropped. Returns null on a malformed clone.
 */
export function attributeClones(clones, inScope, rel) {
    const byFile = new Map();
    for (const clone of clones) {
        if (!isRange(clone.firstFile) || !isRange(clone.secondFile))
            return null;
        const target = [clone.firstFile, clone.secondFile].find((f) => inScope(rel(f.name)));
        if (!target)
            continue;
        const file = rel(target.name);
        byFile.set(file, (byFile.get(file) ?? 0) + target.end - target.start + 1);
    }
    return byFile;
}
export const p43 = {
    id: '4.3',
    layer: 'static',
    async measure(ctx) {
        const files = [...logicFiles(ctx.scope, 'typescript_javascript'), ...logicFiles(ctx.scope, 'python')];
        const tallies = emptyTallies(files);
        if (files.length === 0)
            return { status: 'measured', units: [] };
        const tool = await ctx.tools.resolve('jscpd');
        if (!tool)
            return unavailable(ctx.tools.notFoundReason('jscpd'));
        const copy = await createWorkCopy(ctx.repoPath, files.map((f) => f.path));
        const outDir = await mkdtemp(path.join(tmpdir(), 'health-jscpd-'));
        try {
            const result = await ctx.tools.run(tool, [
                '.',
                '--min-tokens', MIN_TOKENS,
                '--min-lines', MIN_LINES,
                '--reporters', 'json',
                '--output', outDir,
                '--format', 'typescript,javascript,jsx,tsx,python',
                '--max-lines', '1000000',
                '--max-size', '100mb',
                '--no-gitignore',
                '--no-colors',
            ], { cwd: copy.dir });
            const failure = failureReason(tool, result, [0]);
            if (failure)
                return unavailable(failure);
            let duplicates;
            try {
                const report = JSON.parse(readFileSync(path.join(outDir, 'jscpd-report.json'), 'utf8'));
                if (!Array.isArray(report.duplicates))
                    throw new Error('no duplicates array');
                duplicates = report.duplicates;
            }
            catch {
                return unavailable('jscpd report is missing or has an unexpected shape');
            }
            // jscpd 5 reports line totals per format, not per file, so the per-unit numbers are rebuilt here:
            // lines are the file's physical lines (jscpd skips files shorter than min-lines), duplicated
            // lines are the clones attributed to the file, each clone counted once.
            const counted = new Map();
            for (const file of files) {
                const lines = physicalLines(readFileSync(path.join(copy.dir, file.path), 'utf8'));
                if (lines >= Number(MIN_LINES))
                    counted.set(file.path, lines);
            }
            const rel = (name) => path.relative(copy.dir, path.resolve(copy.dir, name)).split(path.sep).join('/');
            const duplicated = attributeClones(duplicates, (file) => counted.has(file), rel);
            if (!duplicated)
                return unavailable('jscpd report has an unexpected shape');
            for (const file of files) {
                const tally = tallies.get(unitId(file));
                const lines = counted.get(file.path);
                if (!tally || lines === undefined)
                    continue;
                tally.denominator += lines;
                tally.numerator += duplicated.get(file.path) ?? 0;
            }
            return { status: 'measured', units: tallyUnits(tallies) };
        }
        finally {
            await copy.cleanup();
            await rm(outDir, { recursive: true, force: true });
        }
    },
};
