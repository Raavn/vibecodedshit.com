import { dimensionScore, healthScore } from './aggregate.js';
function weighted(def, param, overrides) {
    const override = overrides.get(def.id);
    if (override !== undefined)
        return { weight: def.weight, score: override };
    if (param?.status === 'failed')
        return { weight: def.weight, score: 0 };
    if (param?.status === 'measured')
        return { weight: def.weight, score: param.score ?? 0 };
    return { weight: def.weight, score: null };
}
/** The unrounded health and dimension scores if the overridden parameters had the given scores. Reads the stored parameters only. */
export function healthWith(run, methodology, overrides) {
    const dimension = new Map();
    for (const dim of methodology.dimensions) {
        dimension.set(dim.id, dimensionScore(dim.parameters.map((def) => weighted(def, run.parameters.find((p) => p.id === def.id), overrides))));
    }
    return { health: healthScore([...dimension.values()], methodology.capMargin), dimension };
}
/** The lowest-scoring anchor or level above `score` that has a descriptor. Null when there is none or the parameter has no descriptors. */
export function nextCandidate(def, score) {
    const scoring = def.scoring;
    let candidates;
    if (scoring.method === 'piecewise_linear')
        candidates = scoring.anchors;
    else if (scoring.method === 'levels')
        candidates = Array.isArray(scoring.levels) ? scoring.levels : Object.values(scoring.levels).flat();
    else
        return null;
    let best;
    for (const candidate of candidates) {
        if (!candidate.descriptor || candidate.score <= score + 1e-9)
            continue;
        if (!best || candidate.score < best.score)
            best = { score: candidate.score, descriptor: candidate.descriptor };
    }
    return best ? { score: best.score, descriptor: best.descriptor.replace(/\s+/g, ' ').trim() } : null;
}
