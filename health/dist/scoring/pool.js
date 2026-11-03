import { scoreRaw } from './score.js';
/**
 * Combine the units of one parameter into one raw value and score.
 * ratio: sum numerators and denominators, score once. Units with a failed raw (their install root's install
 * failed) take no part in the sums; the score is multiplied by the share of the logic lines that is not failed,
 * so a broken package costs its share and cannot be hidden.
 * unit_weighted: score each unit, combine by weight. A failed unit scores 0.
 */
export function poolParameter(def, units) {
    const scored = units.map((unit) => ({
        ...unit,
        score: scoreRaw(def, unit.raw, unit.group),
    }));
    if (def.pooling === 'ratio') {
        const live = units.filter((unit) => unit.raw.kind !== 'failed');
        const pooled = poolRatio(def, live, scored);
        if (live.length === units.length)
            return pooled;
        return { ...pooled, score: pooled.score * liveShare(live, units) };
    }
    const totalWeight = scored.reduce((sum, unit) => sum + unit.weight, 0);
    if (totalWeight === 0)
        return { raw: null, score: def.raw.when_empty, units: scored };
    const score = scored.reduce((sum, unit) => sum + unit.score * unit.weight, 0) / totalWeight;
    return { raw: null, score, units: scored };
}
/** Share of the logic lines (of the units, when none has a line) that belongs to `live`. */
function liveShare(live, all) {
    const total = all.reduce((sum, unit) => sum + unit.weight, 0);
    if (total === 0)
        return live.length / all.length;
    return live.reduce((sum, unit) => sum + unit.weight, 0) / total;
}
function poolRatio(def, units, scored) {
    let numerator = 0;
    let denominator = 0;
    let scale = null;
    let summed = null;
    for (const unit of units) {
        // number raws (5.1 severity points) are summed, their denominator is ignored.
        if (unit.raw.kind === 'number') {
            summed = (summed ?? 0) + unit.raw.value;
            continue;
        }
        if (unit.raw.kind !== 'ratio')
            throw new Error(`${def.id}: ratio pooling needs ratio raws`);
        if (scale !== null && scale !== unit.raw.scale) {
            throw new Error(`${def.id}: units disagree on ratio scale`);
        }
        scale = unit.raw.scale;
        numerator += unit.raw.numerator;
        denominator += unit.raw.denominator;
    }
    if (summed !== null) {
        if (scale !== null)
            throw new Error(`${def.id}: ratio pooling cannot mix number and ratio raws`);
        const raw = { kind: 'number', value: summed };
        return { raw, score: scoreRaw(def, raw), units: scored };
    }
    if (scale === null || denominator === 0) {
        return { raw: null, score: def.raw.when_empty, units: scored };
    }
    const raw = { kind: 'ratio', numerator, denominator, scale };
    return { raw, score: scoreRaw(def, raw), units: scored };
}
