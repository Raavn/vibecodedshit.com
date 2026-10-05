import { parseCoverageRanges } from '../test-reports/coverage-ranges.js';
import { parseCoverageSummary } from '../test-reports/coverage-summary.js';
import { parseVitestJson } from '../test-reports/vitest-json.js';
import type { RunnerSpec } from './spec.js';

/** vitest 4 has no `coverage.all`; `coverage.include` reports files no test loads. The provider is `@vitest/coverage-v8`, see `health-coverage-install`. */
export const vitest: RunnerSpec = {
  results: 'results.json',
  coverage: 'coverage/coverage-summary.json',
  ranges: 'coverage/coverage-final.json',
  argv: (invocation, globs) => [
    'npx',
    '--no-install',
    'vitest',
    'run',
    '--reporter=json',
    '--outputFile=/out/results.json',
    '--coverage.enabled',
    '--coverage.provider=v8',
    '--coverage.reporter=json-summary',
    '--coverage.reporter=json',
    '--coverage.reportsDirectory=/out/coverage',
    '--coverage.reportOnFailure',
    ...globs.map((glob) => `--coverage.include=${glob}`),
    ...invocation.args,
  ],
  parseResults: parseVitestJson,
  parseCoverage: parseCoverageSummary,
  parseRanges: parseCoverageRanges,
};
