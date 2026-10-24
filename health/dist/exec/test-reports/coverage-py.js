import { toRepoPath } from '../reports.js';
const num = (value) => (typeof value === 'number' ? value : 0);
/** `coverage json` (pytest-cov `--cov-report=json`): `files.<path>.summary`. Null when the text is not that report. */
export function parseCoveragePy(text, stepDir) {
    let doc;
    try {
        doc = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!doc || typeof doc.files !== 'object' || doc.files === null)
        return null;
    const files = new Map();
    for (const [file, entry] of Object.entries(doc.files)) {
        const summary = entry?.summary ?? {};
        files.set(toRepoPath(file, stepDir), {
            lines: { total: num(summary.num_statements), covered: num(summary.covered_lines) },
            branches: { total: num(summary.num_branches), covered: num(summary.covered_branches) },
        });
    }
    return files;
}
