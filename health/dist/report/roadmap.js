import { dimensionScore, healthScore, roundHalfUp } from '../scoring/aggregate.js';
import { rawText } from './format.js';
export const ROADMAP_LIMIT = 10;
const STDOUT_LIMIT = 3;
function weighted(def, param, override) {
    if (override?.id === def.id)
        return { weight: def.weight, score: override.score };
    if (param?.status === 'failed')
        return { weight: def.weight, score: 0 };
    if (param?.status === 'measured')
        return { weight: def.weight, score: param.score ?? 0 };
    return { weight: def.weight, score: null };
}
function healthWith(run, methodology, override) {
    const dimension = new Map();
    for (const dim of methodology.dimensions) {
        dimension.set(dim.id, dimensionScore(dim.parameters.map((def) => weighted(def, run.parameters.find((p) => p.id === def.id), override))));
    }
    return { health: healthScore([...dimension.values()], methodology.capMargin), dimension };
}
/** The descriptor of the lowest-scoring anchor or level above `score`. Null when there is none or the parameter has no descriptors. */
export function targetDescriptor(def, score) {
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
            best = candidate;
    }
    return best?.descriptor?.replace(/\s+/g, ' ').trim() ?? null;
}
/**
 * The parameters ranked by Gain: the whole health points the displayed health would rise by if that one parameter
 * alone reached 100. Parameters at 100 and the not applicable or not measured ones are not listed. Empty when the
 * run has no health score. Items with no Gain are listed only to fill the list up to the limit.
 */
export function buildRoadmap(run, methodology) {
    if (!run.health)
        return [];
    const base = healthWith(run, methodology, null);
    if (base.health === null)
        return [];
    const items = [];
    const dimensionOf = new Map();
    for (const dim of methodology.dimensions) {
        for (const def of dim.parameters) {
            const param = run.parameters.find((p) => p.id === def.id);
            if (!param || (param.status !== 'measured' && param.status !== 'failed'))
                continue;
            const score = param.status === 'failed' ? 0 : (param.score ?? 0);
            if (score >= 100)
                continue;
            const after = healthWith(run, methodology, { id: def.id, score: 100 }).health ?? base.health;
            items.push({
                id: def.id,
                name: def.name,
                dimensionId: dim.id,
                dimensionName: dim.name,
                raw: param.status === 'measured' ? rawText(param, def) : null,
                score,
                gain: roundHalfUp(after) - run.health.displayed,
                gainPrecise: after - base.health,
                target: targetDescriptor(def, score),
            });
            dimensionOf.set(def.id, base.dimension.get(dim.id) ?? 0);
        }
    }
    items.sort((a, b) => b.gain - a.gain || b.gainPrecise - a.gainPrecise || (dimensionOf.get(a.id) ?? 0) - (dimensionOf.get(b.id) ?? 0) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    return items.slice(0, ROADMAP_LIMIT);
}
export function gainText(gain) {
    return gain > 0 ? `+${gain}` : '+0 · no gain';
}
/** The top lines `health report` prints after the report path: `<rank>. <id> <name> (<dimension>) +<gain> — <target>`. */
export function roadmapLines(run, methodology) {
    return buildRoadmap(run, methodology)
        .slice(0, STDOUT_LIMIT)
        .map((item, i) => `${i + 1}. ${item.id} ${item.name} (${item.dimensionName}) ${gainText(item.gain)}${item.target ? ` — ${item.target}` : ''}`);
}
