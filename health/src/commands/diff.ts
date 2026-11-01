import path from 'node:path';
import { parseArgs } from 'node:util';
import { compareRuns, DiffInputError } from '../diff/compare.js';
import { conditionRefusals } from '../diff/conditions.js';
import { formatDiff, formatRefusal } from '../diff/format.js';
import { loadMethodology, MethodologyError } from '../methodology/load.js';
import { readRun, RunReadError } from '../run/read.js';
import { EXIT, type CliIo } from './common.js';

const DIFF_USAGE = 'Usage: health diff <before.json> <after.json> [--json]\n';

export function runDiff(argv: string[], io: CliIo): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' } } });
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n${DIFF_USAGE}`);
    return EXIT.usage;
  }
  const [beforeFile, afterFile] = parsed.positionals;
  if (!beforeFile || !afterFile || parsed.positionals.length > 2) {
    io.stderr(DIFF_USAGE);
    return EXIT.usage;
  }
  const files = [path.resolve(io.cwd, beforeFile), path.resolve(io.cwd, afterFile)] as const;

  try {
    const before = { run: readRun(files[0]), file: files[0] };
    const after = { run: readRun(files[1]), file: files[1] };
    // Mismatched runs are refused before any methodology is loaded, so a version this CLI lacks does not hide the refusal.
    const early = conditionRefusals(before.run, after.run);
    const result =
      early.length > 0
        ? { schemaVersion: 1 as const, compared: false as const, refusals: early }
        : compareRuns(before, after, loadMethodology(before.run.methodology.version));
    if (!result.compared) {
      if (parsed.values.json) io.stdout(`${JSON.stringify(result)}\n`);
      else io.stderr(formatRefusal(result));
      return EXIT.diffRefused;
    }
    io.stdout(parsed.values.json ? `${JSON.stringify(result)}\n` : formatDiff(result));
    return EXIT.ok;
  } catch (err) {
    if (err instanceof RunReadError || err instanceof DiffInputError) {
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
