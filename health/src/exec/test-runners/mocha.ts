import { parseCoverageRanges } from '../test-reports/coverage-ranges.js';
import { parseCoverageSummary } from '../test-reports/coverage-summary.js';
import { parseMochaJson } from '../test-reports/mocha-json.js';
import type { RunnerSpec } from './spec.js';

/** mocha has no coverage of its own: c8 wraps it. `--all` reports files no test loads. */
export const mocha: RunnerSpec = {
  results: 'results.json',
  coverage: 'coverage/coverage-summary.json',
  ranges: 'coverage/coverage-final.json',
  argv: (invocation, globs) => [
    'c8',
    '--reporter=json-summary',
    '--reporter=json',
    '--report-dir=/out/coverage',
    '--all',
    ...globs.flatMap((glob) => ['--include', glob]),
    'npx',
    '--no-install',
    'mocha',
    '--reporter',
    'json',
    '--reporter-option',
    'output=/out/results.json',
    ...invocation.args,
  ],
  parseResults: parseMochaJson,
  parseCoverage: parseCoverageSummary,
  parseRanges: parseCoverageRanges,
};
