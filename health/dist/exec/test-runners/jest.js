import { parseCoverageRanges } from '../test-reports/coverage-ranges.js';
import { parseCoverageSummary } from '../test-reports/coverage-summary.js';
import { parseJestJson } from '../test-reports/jest-json.js';
export const jest = {
    results: 'results.json',
    coverage: 'coverage/coverage-summary.json',
    ranges: 'coverage/coverage-final.json',
    argv: (invocation, globs) => [
        'npx',
        '--no-install',
        'jest',
        '--ci',
        '--json',
        '--outputFile=/out/results.json',
        '--coverage',
        '--coverageProvider=v8',
        '--coverageReporters=json-summary',
        '--coverageReporters=json',
        '--coverageDirectory=/out/coverage',
        ...globs.map((glob) => `--collectCoverageFrom=${glob}`),
        '--coverageThreshold={}',
        ...invocation.args,
    ],
    parseResults: parseJestJson,
    parseCoverage: parseCoverageSummary,
    parseRanges: parseCoverageRanges,
};
