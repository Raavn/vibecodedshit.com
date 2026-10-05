import semver from 'semver';
import { compareVersions, isStable, normalizeName, parseVersion } from '../../util/pep440.js';
import { endOfDay } from './osv.js';
/** Anything but a 404: the registry could not be read. */
export class RegistryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RegistryError';
    }
}
const TIMEOUT_MS = 20_000;
export const CONCURRENCY = 8;
async function getJson(ctx, url) {
    let lastError = 'unknown error';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await ctx.tools.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
            if (response.status === 404)
                return 'not_found';
            if (!response.ok) {
                lastError = `HTTP ${response.status}`;
                continue;
            }
            return (await response.json());
        }
        catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
    }
    throw new RegistryError(`registry request ${url} failed: ${lastError}`);
}
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function npmVersions(doc) {
    const time = record(doc.time) ?? {};
    const found = [];
    for (const version of Object.keys(record(doc.versions) ?? {})) {
        const published = typeof time[version] === 'string' ? Date.parse(time[version]) : Number.NaN;
        if (!Number.isNaN(published))
            found.push({ version, time: published, yanked: false });
    }
    return found;
}
function pypiVersions(doc) {
    const found = [];
    for (const [version, files] of Object.entries(record(doc.releases) ?? {})) {
        if (!Array.isArray(files) || files.length === 0)
            continue;
        const entries = files.map((f) => record(f)).filter((f) => f !== undefined);
        const times = entries
            .map((f) => (typeof f.upload_time_iso_8601 === 'string' ? Date.parse(f.upload_time_iso_8601) : Number.NaN))
            .filter((t) => !Number.isNaN(t));
        if (times.length === 0)
            continue;
        found.push({ version, time: Math.min(...times), yanked: entries.every((f) => f.yanked === true) });
    }
    return found;
}
/** Registry data for one package, memoized per scan. `null` when the registry has no such package (404). */
export function fetchRegistry(ctx, group, name) {
    const key = group === 'python' ? `pypi:${normalizeName(name)}` : `npm:${name}`;
    return ctx.tools.memo(key, async () => {
        const url = group === 'python'
            ? `https://pypi.org/pypi/${encodeURIComponent(normalizeName(name))}/json`
            : `https://registry.npmjs.org/${name.startsWith('@') ? name.replace('/', '%2F') : encodeURIComponent(name)}`;
        const doc = await getJson(ctx, url);
        if (doc === 'not_found')
            return null;
        if (!doc)
            throw new RegistryError(`registry request ${url} returned no document`);
        return { versions: group === 'python' ? pypiVersions(doc) : npmVersions(doc) };
    });
}
/** Highest stable, non-yanked version published at or before the end of the as-of day. */
export function latestStable(data, group, asOf) {
    const limit = endOfDay(asOf);
    const candidates = data.versions.filter((v) => !v.yanked && v.time <= limit);
    if (group === 'python') {
        let top;
        for (const { version } of candidates) {
            const parsed = parseVersion(version);
            if (!parsed || !isStable(parsed))
                continue;
            if (!top || compareVersions(parsed, top.parsed) > 0)
                top = { text: version, parsed };
        }
        return top?.text;
    }
    return candidates
        .map((v) => v.version)
        .filter((v) => semver.valid(v) !== null && semver.prerelease(v) === null)
        .sort(semver.compare)
        .pop();
}
function parts(version, group) {
    if (group === 'python') {
        const parsed = parseVersion(version);
        if (!parsed)
            return undefined;
        return {
            release: parsed.release,
            cmp: (other) => {
                const o = parseVersion(other);
                return o ? compareVersions(parsed, o) : 0;
            },
        };
    }
    const parsed = semver.parse(version);
    if (!parsed)
        return undefined;
    return { release: [parsed.major, parsed.minor, parsed.patch], cmp: (other) => semver.compare(version, other) };
}
/** At least one major behind; for 0.x a minor bump counts as a major. A resolved version newer than latest is not behind. */
export function isMajorBehind(resolved, latest, group) {
    const r = parts(resolved, group);
    const l = parts(latest, group);
    if (!r || !l)
        return false;
    if (r.cmp(latest) >= 0)
        return false;
    const [rMajor = 0, rMinor = 0] = r.release;
    const [lMajor = 0, lMinor = 0] = l.release;
    if (lMajor > rMajor)
        return true;
    return rMajor === 0 && lMajor === 0 && lMinor > rMinor;
}
/** Population and behind count of `direct` against one registry snapshot. Keys of `registryData`: `<group>:<name>`. */
export function majorsBehind(direct, registryData, asOf) {
    let numerator = 0;
    let denominator = 0;
    for (const dep of direct) {
        const data = registryData.get(`${dep.group}:${dep.group === 'python' ? normalizeName(dep.name) : dep.name}`);
        if (!data)
            continue;
        denominator += 1;
        const latest = latestStable(data, dep.group, asOf);
        if (latest !== undefined && isMajorBehind(dep.version, latest, dep.group))
            numerator += 1;
    }
    return { numerator, denominator };
}
