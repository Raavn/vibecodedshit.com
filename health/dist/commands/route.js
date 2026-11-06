import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadMethodology, MethodologyError } from '../methodology/load.js';
import { readRun, RunReadError } from '../run/read.js';
import { checkRouteFiles } from '../route/check.js';
import { buildRouteFiles } from '../route/files.js';
import { buildRoute, routeLines } from '../route/select.js';
import { writeRouteFiles } from '../route/write.js';
import { EXIT } from './common.js';
const ROUTE_USAGE = 'Usage: health route <run.json> --out <dir>\n       health route --check <dir> <run.json>\n';
export function runRoute(argv, io) {
    let parsed;
    try {
        parsed = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' }, check: { type: 'string' } } });
    }
    catch (err) {
        io.stderr(`${err instanceof Error ? err.message : String(err)}\n${ROUTE_USAGE}`);
        return EXIT.usage;
    }
    const [input] = parsed.positionals;
    const { out, check } = parsed.values;
    if (!input || parsed.positionals.length > 1 || (out === undefined) === (check === undefined)) {
        io.stderr(ROUTE_USAGE);
        return EXIT.usage;
    }
    try {
        const run = readRun(path.resolve(io.cwd, input));
        if (!run.valid) {
            io.stderr(`run.json is invalid: ${run.invalidReason ?? 'no reason given'}\n`);
            return EXIT.usage;
        }
        const methodology = loadMethodology(run.methodology.version);
        const plan = buildRoute(run, methodology);
        const files = buildRouteFiles(run, methodology, plan);
        if (check !== undefined) {
            const problems = checkRouteFiles(path.resolve(io.cwd, check), files);
            if (problems.length > 0) {
                io.stderr(`${problems.join('\n')}\n`);
                return EXIT.usage;
            }
            io.stdout('Route files match run.json\n');
            return EXIT.ok;
        }
        const lines = routeLines(plan);
        if (files.length > 0 && out !== undefined)
            writeRouteFiles(path.resolve(io.cwd, out), files);
        if (lines.length > 0)
            io.stdout(`${lines.join('\n')}\n`);
        return EXIT.ok;
    }
    catch (err) {
        if (err instanceof RunReadError) {
            io.stderr(`${err.message}\n`);
            return EXIT.usage;
        }
        if (err instanceof MethodologyError) {
            io.stderr(`Methodology error: ${err.message}\n`);
            return EXIT.methodology;
        }
        throw err;
    }
}
