import { roundHalfUp } from '../scoring/aggregate.js';
import { conditionRefusals, notComparableRefusals } from './conditions.js';
/** methodology.yaml `regression.flag_when`: a dimension drops by this much or more, unrounded. */
const REGRESSION_DROP = 3.0;
const TOLERANCE = 1e-9;
export class DiffInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DiffInputError';
    }
}
function side(run, file, methodology) {
    const health = run.health;
    if (!health)
        throw new DiffInputError(`${file}: run has no health score`);
    const band = methodology.bands.find((b) => b.key === health.band);
    if (!band)
        throw new DiffInputError(`${file}: unknown band "${health.band}" for methodology ${methodology.version}`);
    return {
        path: run.repo.path,
        headCommit: run.repo.headCommit,
        treeHash: run.repo.treeHash,
        health: { score: health.score, displayed: health.displayed, band: band.key, bandName: band.name },
    };
}
function dimensionScore(run, id) {
    return run.dimensions.find((d) => d.id === id)?.score ?? null;
}
/** Refuse when the five conditions differ or a run cannot be compared; otherwise compare the stored scores. */
export function compareRuns(a, b, methodology) {
    const refusals = conditionRefusals(a.run, b.run);
    if (refusals.length === 0)
        refusals.push(...notComparableRefusals(a.run, b.run));
    if (refusals.length > 0)
        return { schemaVersion: 1, compared: false, refusals };
    const before = side(a.run, a.file, methodology);
    const after = side(b.run, b.file, methodology);
    const rank = (key) => methodology.bands.findIndex((band) => band.key === key);
    const bandDrop = rank(after.health.band) < rank(before.health.band);
    const dimensions = methodology.dimensions.map((def) => {
        const from = dimensionScore(a.run, def.id);
        const to = dimensionScore(b.run, def.id);
        const both = from !== null && to !== null;
        return {
            id: def.id,
            key: def.key,
            name: def.name,
            before: from === null ? null : roundHalfUp(from),
            after: to === null ? null : roundHalfUp(to),
            delta: both ? roundHalfUp(to - from) : null,
            regressed: both && from - to >= REGRESSION_DROP - TOLERANCE,
        };
    });
    const regressed = dimensions.filter((d) => d.regressed).map((d) => d.id);
    return {
        schemaVersion: 1,
        compared: true,
        methodologyVersion: methodology.version,
        asOf: a.run.asOf,
        before,
        after,
        healthDelta: roundHalfUp(after.health.score - before.health.score, 1),
        bandChange: {
            from: before.health.band,
            to: after.health.band,
            fromName: before.health.bandName,
            toName: after.health.bandName,
            dropped: bandDrop,
        },
        dimensions,
        regression: { flag: regressed.length > 0 || bandDrop, dimensions: regressed, bandDrop },
    };
}
