import { band, cvss3BaseScore } from './cvss.js';
const POINTS = { critical: 10, high: 5, moderate: 2, low: 0.5, none: 0 };
const LABELS = {
    CRITICAL: 'critical',
    HIGH: 'high',
    MODERATE: 'moderate',
    MEDIUM: 'moderate',
    LOW: 'low',
};
export function endOfDay(asOf) {
    return Date.parse(`${asOf}T23:59:59.999Z`);
}
/** Published at or before the end of the as-of day (no `published` is kept) and not withdrawn. */
function counts(record, asOf) {
    if (record.withdrawn !== undefined && record.withdrawn !== '')
        return false;
    if (record.published === undefined)
        return true;
    const published = Date.parse(record.published);
    return Number.isNaN(published) || published <= endOfDay(asOf);
}
const ORDER = ['none', 'low', 'moderate', 'high', 'critical'];
function highest(values) {
    return values.reduce((top, v) => (top === undefined || ORDER.indexOf(v) > ORDER.indexOf(top) ? v : top), undefined);
}
/** Methodology 5.1 order: GHSA label, then CVSS v3.x base score band, then moderate. */
function groupSeverity(records) {
    const labelled = records
        .map((r) => LABELS[(r.database_specific?.severity ?? '').toUpperCase()])
        .filter((s) => s !== undefined);
    const label = highest(labelled);
    if (label !== undefined)
        return label;
    const scored = [];
    for (const record of records) {
        for (const entry of record.severity ?? []) {
            if (entry.type !== 'CVSS_V3' || !entry.score?.startsWith('CVSS:3.'))
                continue;
            const score = cvss3BaseScore(entry.score);
            if (score !== undefined)
                scored.push(band(score));
        }
    }
    return highest(scored) ?? 'moderate';
}
/** Group the records of one package into advisories by alias closure. */
function advisories(records) {
    const parent = new Map();
    const find = (x) => {
        let root = parent.get(x) ?? x;
        while ((parent.get(root) ?? root) !== root)
            root = parent.get(root) ?? root;
        parent.set(x, root);
        return root;
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb)
            parent.set(ra, rb);
    };
    for (const r of records) {
        find(r.id);
        for (const alias of r.aliases ?? [])
            union(r.id, alias);
    }
    const groups = new Map();
    for (const r of records) {
        const root = find(r.id);
        groups.set(root, [...(groups.get(root) ?? []), r]);
    }
    return [...groups.values()];
}
/** Severity points of the advisories that count at the as-of date. Each advisory counts once per package. */
export function severityPoints(packages, asOf) {
    const found = [];
    for (const pkg of packages) {
        const records = pkg.vulnerabilities.filter((r) => counts(r, asOf));
        for (const group of advisories(records)) {
            const severity = groupSeverity(group);
            const first = group[0];
            if (!first)
                continue;
            found.push({ name: pkg.name, version: pkg.version, dev: pkg.dev, id: first.id, severity, points: POINTS[severity] });
        }
    }
    return { points: found.reduce((sum, a) => sum + a.points, 0), advisories: found };
}
/** Packages of an osv-scanner JSON report. Undefined when the shape is not recognised. */
export function parseOsvReport(text) {
    let json;
    try {
        json = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    const results = json?.results;
    if (results === null || results === undefined)
        return [];
    if (!Array.isArray(results))
        return undefined;
    const found = [];
    for (const result of results) {
        if (!Array.isArray(result?.packages))
            continue;
        for (const entry of result.packages) {
            const { name, version, ecosystem } = entry.package ?? {};
            if (typeof name !== 'string' || typeof version !== 'string')
                return undefined;
            const groups = Array.isArray(entry.dependency_groups) ? entry.dependency_groups : [];
            found.push({
                name,
                version,
                ecosystem: typeof ecosystem === 'string' ? ecosystem : '',
                dev: groups.includes('dev'),
                vulnerabilities: Array.isArray(entry.vulnerabilities) ? entry.vulnerabilities : [],
            });
        }
    }
    return found;
}
