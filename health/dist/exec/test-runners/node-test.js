import { parseCoverageSummary } from '../test-reports/coverage-summary.js';
import { parseJunit } from '../test-reports/junit.js';
export const nodeTest = {
    results: 'junit.xml',
    coverage: 'coverage/coverage-summary.json',
    argv: (invocation, globs) => [
        'c8',
        '--reporter=json-summary',
        '--report-dir=/out/coverage',
        '--all',
        ...globs.flatMap((glob) => ['--include', glob]),
        'node',
        '--test',
        '--test-reporter=junit',
        '--test-reporter-destination=/out/junit.xml',
        ...invocation.args,
    ],
    parseResults: parseJunit,
    parseCoverage: parseCoverageSummary,
};
