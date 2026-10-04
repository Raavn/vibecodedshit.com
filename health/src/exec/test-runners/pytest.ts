import { parseCoveragePy } from '../test-reports/coverage-py.js';
import { parseJunit } from '../test-reports/junit.js';
import type { RunnerSpec } from './spec.js';

/** pytest also runs unittest suites. `health-pytest` is `python -m pytest` in the repository's environment, with the image's pytest and pytest-cov when it has none. */
export const pytest: RunnerSpec = {
  results: 'junit.xml',
  coverage: 'coverage.json',
  argv: (_invocation, _globs, targets) => [
    'health-pytest',
    '--continue-on-collection-errors',
    '--junitxml=/out/junit.xml',
    ...targets.map((target) => `--cov=${target}`),
    '--cov-branch',
    '--cov-report=json:/out/coverage.json',
    '--cov-fail-under=0',
  ],
  parseResults: parseJunit,
  parseCoverage: parseCoveragePy,
};
