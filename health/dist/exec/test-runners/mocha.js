import { parseCoverageSummary } from '../test-reports/coverage-summary.js';
import { parseMochaJson } from '../test-reports/mocha-json.js';
/** mocha has no coverage of its own: c8 wraps it. `--all` reports files no test loads. */
export const mocha = {
    results: 'results.json',
    coverage: 'coverage/coverage-summary.json',
    argv: (invocation, globs) => [
        'c8',
        '--reporter=json-summary',
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
};
