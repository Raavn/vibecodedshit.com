import { toRepoPath } from '../reports.js';
function part(value) {
    return { total: typeof value?.total === 'number' ? value.total : 0, covered: typeof value?.covered === 'number' ? value.covered : 0 };
}
/** The istanbul `json-summary` reporter (also c8 and the v8 provider): one entry per file next to `total`. Null when the text is not that report. */
export function parseCoverageSummary(text, stepDir) {
    let doc;
    try {
        doc = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (typeof doc !== 'object' || doc === null || typeof doc.total !== 'object')
        return null;
    const files = new Map();
    for (const [file, entry] of Object.entries(doc)) {
        if (file === 'total' || typeof entry !== 'object' || entry === null)
            continue;
        files.set(toRepoPath(file, stepDir), { lines: part(entry.lines), branches: part(entry.branches) });
    }
    return files;
}
