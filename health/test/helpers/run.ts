import { loadMethodology } from '../../src/methodology/load.js';
import { parseRun } from '../../src/run/read.js';
import type { RunFile } from '../../src/run/schema.js';
import { healthFrom } from '../../src/run/score-run.js';

const methodology = loadMethodology('1.0');

export interface MakeRunOptions extends Partial<Omit<RunFile, 'tools'>> {
  /** Stored dimension scores in dimension order, unrounded. Health and band are derived from them unless `health` is given. */
  scores?: (number | null)[];
  /** Merged over the default tools, which include an image digest as a full run has. */
  tools?: Record<string, unknown>;
}

/** A schema-valid synthetic comparable run. No Docker, no scan. */
export function makeRun(options: MakeRunOptions = {}): RunFile {
  const { scores = [70, 70, 70, 70, 70, 70], tools, ...overrides } = options;
  const dimensions = methodology.dimensions.map((d, i) => ({ id: d.id, key: d.key, score: scores[i] ?? null }));
  const run = {
    schemaVersion: 1,
    valid: true,
    warnings: [],
    methodology: { version: '1.0' },
    mode: 'full',
    comparable: true,
    asOf: '2026-10-04',
    layers: ['static', 'execution'],
    repo: { path: '/work/repo', headCommit: 'a'.repeat(40), treeHash: 'b'.repeat(40) },
    tools: { health: '0.1.0', node: 'v22.0.0', typescript: '5.9.3', git: '2.50.0', image: { digest: 'sha256:abc' }, ...tools },
    ignoreSet: { healthignoreSha256: null, gitleaksignoreSha256: null, excludedLinesPercent: 0 },
    scope: { logicFiles: 1, logicLines: 10, sourceLines: 10, packages: ['.'] },
    parameters: [],
    dimensions,
    breakdown: { byPackage: {}, byGroup: {} },
    health: healthFrom(methodology, dimensions),
    ...overrides,
  };
  // Checked against the same zod schema the commands read with.
  return parseRun(JSON.stringify(run), 'makeRun');
}
