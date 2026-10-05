import { roundHalfUp } from '../scoring/aggregate.js';
function round1(value) {
    return roundHalfUp(value, 1).toFixed(1);
}
function scaleLabel(scale) {
    if (scale === 100)
        return '%';
    if (scale === 1000)
        return ' per 1,000';
    return ` per ${scale}`;
}
function formatRaw(raw, unit) {
    switch (raw.kind) {
        case 'ratio':
            return raw.denominator === 0
                ? `${raw.numerator} / 0`
                : `${raw.numerator} / ${raw.denominator} (${round1((raw.numerator / raw.denominator) * raw.scale)}${scaleLabel(raw.scale)})`;
        case 'level':
            return raw.level;
        case 'number':
            return `${raw.value} ${unit}`;
        case 'components':
            return Object.entries(raw.components)
                .map(([key, part]) => `${key}: ${formatRaw(part, unit)}`)
                .join('; ');
    }
}
/** The raw value as the report prints it. Level parameters have no pooled raw, so their units' levels are listed. */
export function rawText(param, def) {
    if (param.raw)
        return formatRaw(param.raw, def.raw.unit);
    const levels = [...new Set((param.units ?? []).flatMap((u) => (u.raw.kind === 'level' ? [u.raw.level] : [])))];
    if (levels.length > 0)
        return levels.join(', ');
    const components = (param.units ?? []).flatMap((u) => (u.raw.kind === 'components' ? [u.raw] : []));
    if (components.length > 0)
        return components.map((c) => formatRaw(c, def.raw.unit)).join(' | ');
    return 'no data';
}
/**
 * The descriptor of the anchor or level whose score is closest to the parameter's score, ties to the lower score.
 * Null for parameters without descriptors (components).
 */
export function nearestDescriptor(def, score) {
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
        if (!candidate.descriptor)
            continue;
        if (!best) {
            best = candidate;
            continue;
        }
        const gap = Math.abs(candidate.score - score);
        const bestGap = Math.abs(best.score - score);
        if (gap < bestGap - 1e-9 || (Math.abs(gap - bestGap) <= 1e-9 && candidate.score < best.score))
            best = candidate;
    }
    return best?.descriptor?.replace(/\s+/g, ' ').trim() ?? null;
}
export function statusText(status) {
    return status.replace('_', ' ');
}
export function scoreText(score) {
    return score === null || score === undefined ? '–' : String(roundHalfUp(score));
}
