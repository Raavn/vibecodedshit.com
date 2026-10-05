export class PayloadError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PayloadError';
    }
}
/**
 * Build the payload from an allowlist of run.json fields, never by spreading the run.
 * `units`, `breakdown`, `repo`, `warnings`, reasons, `scope` and `ignoreSet` hold paths or local information and are left out.
 * Values are copied unchanged; nothing is computed or rounded.
 */
export function buildPayload({ run, repoHash, repoName, summary, email }) {
    const digest = run.tools.image?.digest;
    if (!run.health)
        throw new PayloadError('run.json has no health score.');
    if (!digest)
        throw new PayloadError('run.json has no execution image digest (tools.image.digest).');
    const dimensions = run.dimensions.map((d) => {
        if (d.score === null)
            throw new PayloadError(`dimension ${d.id} has no score.`);
        return { id: d.id, score: d.score };
    });
    return {
        repoHash,
        ...(repoName === undefined ? {} : { repoName }),
        methodologyVersion: run.methodology.version,
        imageDigest: digest,
        asOf: run.asOf,
        health: run.health.displayed,
        band: run.health.band,
        dimensions,
        parameters: run.parameters.map((p) => ({
            id: p.id,
            status: p.status,
            ...(p.raw === undefined || p.raw === null ? {} : { raw: p.raw }),
            ...(p.score === undefined ? {} : { score: p.score }),
        })),
        ...(summary === undefined ? {} : { summary }),
        ...(email === undefined ? {} : { email }),
    };
}
