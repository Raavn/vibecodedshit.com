import path from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT } from './commands/common.js';
import { runDiff } from './commands/diff.js';
import { runReport } from './commands/report.js';
import { loadMethodology, MethodologyError } from './methodology/load.js';
import { invalidRun, NoLogicFilesError, runScan } from './run/scan.js';
import { writeRun } from './run/write.js';
import { NotAGitRepositoryError } from './scope/build.js';
import { ToolError } from './scope/types.js';
export { EXIT } from './commands/common.js';
const USAGE = `Usage: health scan <path> [--preview] [--as-of YYYY-MM-DD] [--out <file>] [--methodology <version>]
       health report <run.json> [--out <file>]
       health diff <before.json> <after.json> [--json]

Exit codes: 0 ok, 1 usage or unreadable input, 2 methodology error, 3 no logic file, 4 tool error, 5 diff refused.
`;
function round1(value) {
    return (Math.round(value * 10) / 10).toFixed(1);
}
export function summarize(run, methodology) {
    const lines = [];
    if (run.health) {
        const band = methodology.bands.find((b) => b.key === run.health?.band);
        lines.push(`Health ${run.health.displayed} ${band?.name ?? run.health.band} (${run.mode === 'preview' ? 'preview, ' : ''}${run.comparable ? 'comparable' : 'not comparable'})`);
    }
    for (const dimension of run.dimensions) {
        if (dimension.score === null)
            continue;
        const def = methodology.dimensions.find((d) => d.id === dimension.id);
        lines.push(`Dimension ${dimension.id} ${def?.name ?? dimension.key}: ${Math.floor(dimension.score + 0.5 + 1e-9)}`);
    }
    const names = new Map(methodology.dimensions.flatMap((d) => d.parameters).map((p) => [p.id, p.name]));
    for (const param of run.parameters) {
        if (param.status === 'not_measured' && param.reason && !/^(execution layer|not implemented)/.test(param.reason)) {
            lines.push(`${param.id} ${names.get(param.id) ?? ''}: not measured (${param.reason})`);
            continue;
        }
        if (param.status !== 'measured')
            continue;
        const raw = param.raw;
        const levels = [...new Set((param.units ?? []).flatMap((u) => (u.raw.kind === 'level' ? [u.raw.level] : [])))];
        const shown = raw && raw.kind === 'ratio'
            ? `${round1((raw.numerator / raw.denominator) * raw.scale)}%`
            : levels.length > 0
                ? levels.join(', ')
                : 'n/a';
        lines.push(`${param.id} ${names.get(param.id) ?? ''}: ${shown} -> ${Math.floor((param.score ?? 0) + 0.5 + 1e-9)}`);
    }
    return `${lines.join('\n')}\n`;
}
export async function run(argv, io, deps = {}) {
    if (argv[0] === 'report')
        return runReport(argv.slice(1), io);
    if (argv[0] === 'diff')
        return runDiff(argv.slice(1), io);
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                preview: { type: 'boolean' },
                'as-of': { type: 'string' },
                out: { type: 'string' },
                methodology: { type: 'string' },
            },
        });
    }
    catch (err) {
        io.stderr(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
        return EXIT.usage;
    }
    const [command, target] = parsed.positionals;
    if (command !== 'scan' || !target || parsed.positionals.length > 2) {
        io.stderr(USAGE);
        return EXIT.usage;
    }
    const asOf = parsed.values['as-of'] ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(asOf))) {
        io.stderr(`--as-of must be a date like 2026-10-04, got "${asOf}"\n`);
        return EXIT.usage;
    }
    const opts = {
        repoPath: path.resolve(io.cwd, target),
        methodologyVersion: parsed.values.methodology ?? '1.0',
        mode: parsed.values.preview ? 'preview' : 'full',
        asOf,
        ...deps,
    };
    const outFile = path.resolve(io.cwd, parsed.values.out ?? 'run.json');
    let methodology;
    try {
        methodology = loadMethodology(opts.methodologyVersion);
    }
    catch (err) {
        if (err instanceof MethodologyError) {
            io.stderr(`Methodology error: ${err.message}\n`);
            return EXIT.methodology;
        }
        throw err;
    }
    try {
        const result = await runScan(opts, methodology);
        writeRun(outFile, result);
        io.stdout(summarize(result, methodology));
        return EXIT.ok;
    }
    catch (err) {
        if (err instanceof NoLogicFilesError) {
            io.stderr(`${err.message}\n`);
            return EXIT.noLogic;
        }
        if (err instanceof NotAGitRepositoryError) {
            io.stderr(`${err.message}\n`);
            return EXIT.usage;
        }
        if (err instanceof ToolError) {
            writeRun(outFile, invalidRun(opts, err.message));
            io.stderr(`Tool error: ${err.message}\n`);
            return EXIT.tool;
        }
        throw err;
    }
}
