import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { failureReason, notFoundReason, unavailable } from '../tools/outcome.js';
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
/** Union of inclusive line ranges. */
function coveredLines(ranges) {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    let total = 0;
    let end = 0;
    for (const [from, to] of sorted) {
        const start = Math.max(from, end + 1);
        if (to >= start)
            total += to - start + 1;
        end = Math.max(end, to);
    }
    return total;
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
            return unavailable(ctx, notFoundReason('jscpd'));
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
                return unavailable(ctx, failure);
            let duplicates;
            try {
                const report = JSON.parse(readFileSync(path.join(outDir, 'jscpd-report.json'), 'utf8'));
                if (!Array.isArray(report.duplicates))
                    throw new Error('no duplicates array');
                duplicates = report.duplicates;
            }
            catch {
                return unavailable(ctx, 'jscpd report is missing or has an unexpected shape');
            }
            const rangesByFile = new Map();
            for (const clone of duplicates) {
                for (const fragment of [clone.firstFile, clone.secondFile]) {
                    if (!fragment || typeof fragment.name !== 'string' || typeof fragment.start !== 'number' || typeof fragment.end !== 'number') {
                        return unavailable(ctx, 'jscpd report has an unexpected shape');
                    }
                    const rel = path.relative(copy.dir, path.resolve(copy.dir, fragment.name)).split(path.sep).join('/');
                    const list = rangesByFile.get(rel) ?? [];
                    list.push([fragment.start, fragment.end]);
                    rangesByFile.set(rel, list);
                }
            }
            // jscpd 5 reports line totals per format, not per file, so the per-file numbers are rebuilt here:
            // lines are the file's physical lines (jscpd skips files shorter than min-lines), duplicated
            // lines are the union of the clone ranges that cover the file.
            for (const file of files) {
                const tally = tallies.get(unitId(file));
                if (!tally)
                    continue;
                const lines = physicalLines(readFileSync(path.join(copy.dir, file.path), 'utf8'));
                if (lines < Number(MIN_LINES))
                    continue;
                tally.denominator += lines;
                tally.numerator += coveredLines(rangesByFile.get(file.path) ?? []);
            }
            return { status: 'measured', units: tallyUnits(tallies) };
        }
        finally {
            await copy.cleanup();
            await rm(outDir, { recursive: true, force: true });
        }
    },
};
