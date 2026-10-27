import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadMethodology, MethodologyError } from '../methodology/load.js';
import { renderReport } from '../report/render.js';
import { roadmapLines } from '../report/roadmap.js';
import { readRun, RunReadError } from '../run/read.js';
import { EXIT, type CliIo } from './common.js';

export const REPORT_USAGE = 'Usage: health report <run.json> [--out <file>]\n';

export function runReport(argv: string[], io: CliIo): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' } } });
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n${REPORT_USAGE}`);
    return EXIT.usage;
  }
  const [input] = parsed.positionals;
  if (!input || parsed.positionals.length > 1) {
    io.stderr(REPORT_USAGE);
    return EXIT.usage;
  }
  // The default is the current directory, never the scanned repository, the same rule as run.json.
  const outFile = path.resolve(io.cwd, parsed.values.out ?? 'health-report.html');

  try {
    const run = readRun(path.resolve(io.cwd, input));
    if (!run.valid) {
      io.stderr(`run.json is invalid: ${run.invalidReason ?? 'no reason given'}\n`);
      return EXIT.usage;
    }
    const methodology = loadMethodology(run.methodology.version);
    writeFileSync(outFile, renderReport(run, methodology), 'utf8');
    io.stdout(`${[outFile, ...roadmapLines(run, methodology)].join('\n')}\n`);
    return EXIT.ok;
  } catch (err) {
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
