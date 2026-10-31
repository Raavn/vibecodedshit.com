import { existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { findPreviousRun, type Health } from '../card/previous.js';
import { renderCard } from '../card/render.js';
import { loadMethodology, MethodologyError, type Methodology } from '../methodology/load.js';
import { readRun, RunReadError } from '../run/read.js';
import { EXIT, type CliIo } from './common.js';

export const CARD_USAGE = 'Usage: health card <run.json> --history <dir> [--out <file>]\n';

function side(health: Health, methodology: Methodology): { score: number; tier: string } {
  return { score: health.displayed, tier: methodology.bands.find((b) => b.key === health.band)?.name ?? health.band };
}

/** Writes a PNG card comparing a run with the previous run of the same repository in `--history`. No previous run, no card. */
export async function runCard(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' }, history: { type: 'string' } } });
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n${CARD_USAGE}`);
    return EXIT.usage;
  }
  const [input] = parsed.positionals;
  const history = parsed.values.history;
  if (!input || !history || parsed.positionals.length > 1) {
    io.stderr(CARD_USAGE);
    return EXIT.usage;
  }
  const historyDir = path.resolve(io.cwd, history);
  if (!existsSync(historyDir) || !statSync(historyDir).isDirectory()) {
    io.stderr(`--history ${historyDir}: not a directory\n`);
    return EXIT.usage;
  }
  // The default is the current directory, never the scanned repository, the same rule as run.json.
  const outFile = path.resolve(io.cwd, parsed.values.out ?? 'health-card.png');

  try {
    const file = path.resolve(io.cwd, input);
    const run = readRun(file);
    if (!run.valid) {
      io.stderr(`run.json is invalid: ${run.invalidReason ?? 'no reason given'}\n`);
      return EXIT.usage;
    }
    if (run.health === null) {
      io.stderr('No card: the run has no health score.\n');
      return EXIT.ok;
    }
    const previous = findPreviousRun(file, run, historyDir);
    if (!previous) {
      io.stderr(`No card: no earlier ${run.mode} run of ${run.repo.path} for methodology ${run.methodology.version} in ${historyDir}.\n`);
      return EXIT.ok;
    }
    const methodology = loadMethodology(run.methodology.version);
    const card = { repo: path.basename(run.repo.path), before: side(previous.health, methodology), after: side(run.health, methodology) };
    writeFileSync(outFile, await renderCard(card));
    io.stdout(`${outFile}\n`);
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
