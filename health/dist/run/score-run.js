import { bandFor, dimensionScore, healthScore, roundHalfUp } from '../scoring/aggregate.js';
import { poolParameter } from '../scoring/pool.js';
function liveScore(def, param, units) {
    if (!param)
        return null;
    if (param.status === 'failed')
        return 0;
    if (param.status !== 'measured')
        return null;
    return poolParameter(def, units ?? param.units ?? []).score;
}
export function dimensionScores(methodology, parameters, filter) {
    return methodology.dimensions.map((dimension) => {
        const weighted = dimension.parameters.map((def) => {
            const param = parameters.find((p) => p.id === def.id);
            if (filter && param?.status === 'measured') {
                const units = (param.units ?? []).filter(filter);
                // A package or language with no units for a parameter has no data for it.
                return { weight: def.weight, score: units.length === 0 ? null : liveScore(def, param, units) };
            }
            return { weight: def.weight, score: liveScore(def, param) };
        });
        return { id: dimension.id, key: dimension.key, score: dimensionScore(weighted) };
    });
}
export function healthFrom(methodology, dimensions) {
    const score = healthScore(dimensions.map((d) => d.score), methodology.capMargin);
    if (score === null)
        return null;
    const displayed = roundHalfUp(score);
    return { score, displayed, band: bandFor(displayed, methodology.bands).key };
}
export function breakdownFor(methodology, parameters) {
    const units = parameters.flatMap((p) => p.units ?? []);
    const packages = [...new Set(units.map((u) => u.package))].sort();
    const groups = [...new Set(units.map((u) => u.group))].sort();
    const toRecord = (dims) => Object.fromEntries(dims.map((d) => [String(d.id), d.score]));
    return {
        byPackage: Object.fromEntries(packages.map((pkg) => [pkg, toRecord(dimensionScores(methodology, parameters, (u) => u.package === pkg))])),
        byGroup: Object.fromEntries(groups.map((group) => [group, toRecord(dimensionScores(methodology, parameters, (u) => u.group === group))])),
    };
}
