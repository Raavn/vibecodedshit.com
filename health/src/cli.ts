import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadMethodology, MethodologyError, type Methodology } from './methodology/load.js';
import type { RunFile } from './run/schema.js';
import { invalidRun, NoLogicFilesError, runScan, type ScanOptions } from './run/scan.js';
import { writeRun } from './run/write.js';
import { NotAGitRepositoryError } from './scope/build.js';
import { ToolError } from './scope/types.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

export const EXIT = { ok: 0, usage: 1, methodology: 2, noLogic: 3, tool: 4 } as const;

const USAGE = `Usage: health scan <path> [--preview] [--as-of YYYY-MM-DD] [--out <file>] [--methodology <version>]
`;

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function summarize(run: RunFile, methodology: Methodology): string {
  const lines: string[] = [];
  if (run.health) {
    const band = methodology.bands.find((b) => b.key === run.health?.band);
    lines.push(`Health ${run.health.displayed} ${band?.name ?? run.health.band} (preview, not comparable)`);
  }
  for (const dimension of run.dimensions) {
    if (dimension.score === null) continue;
    const def = methodology.dimensions.find((d) => d.id === dimension.id);
    lines.push(`Dimension ${dimension.id} ${def?.name ?? dimension.key}: ${Math.floor(dimension.score + 0.5 + 1e-9)}`);
  }
  const names = new Map(methodology.dimensions.flatMap((d) => d.parameters).map((p) => [p.id, p.name]));
  for (const param of run.parameters) {
    if (param.status !== 'measured') continue;
    const raw = param.raw;
    const shown = raw && raw.kind === 'ratio' ? `${round1((raw.numerator / raw.denominator) * raw.scale)}%` : 'n/a';
    lines.push(`${param.id} ${names.get(param.id) ?? ''}: ${shown} -> ${Math.floor((param.score ?? 0) + 0.5 + 1e-9)}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function run(argv: string[], io: CliIo): Promise<number> {
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
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return EXIT.usage;
  }

  const [command, target] = parsed.positionals;
  if (command !== 'scan' || !target || parsed.positionals.length > 2) {
    io.stderr(USAGE);
    return EXIT.usage;
  }
  if (!parsed.values.preview) {
    io.stderr('Full runs need the health:1.0 image, which is not available yet. Use --preview.\n');
    return EXIT.usage;
  }

  const asOf = parsed.values['as-of'] ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(asOf))) {
    io.stderr(`--as-of must be a date like 2026-10-04, got "${asOf}"\n`);
    return EXIT.usage;
  }

  const opts: ScanOptions = {
    repoPath: path.resolve(io.cwd, target),
    methodologyVersion: parsed.values.methodology ?? '1.0',
    mode: 'preview',
    asOf,
  };
  const outFile = path.resolve(io.cwd, parsed.values.out ?? 'run.json');

  let methodology: Methodology;
  try {
    methodology = loadMethodology(opts.methodologyVersion);
  } catch (err) {
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
  } catch (err) {
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
