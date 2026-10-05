function signed(value, digits) {
    const text = value.toFixed(digits);
    return value >= 0 ? `+${text}` : text;
}
/** Human output: health line, one line per changed dimension, regression line. */
export function formatDiff(result) {
    const lines = [`Health ${result.after.health.displayed} ${result.after.health.bandName} (${signed(result.healthDelta, 1)})`];
    for (const d of result.dimensions) {
        if (d.delta === null || d.delta === 0)
            continue;
        lines.push(`Dimension ${d.id} ${d.name}: ${signed(d.delta, 0)}`);
    }
    const regressions = result.dimensions
        .filter((d) => d.regressed)
        .map((d) => `${d.name} ${signed(d.delta ?? 0, 0)}`);
    if (result.regression.bandDrop)
        regressions.push(`band ${result.bandChange.fromName} -> ${result.bandChange.toName}`);
    lines.push(`Regression: ${regressions.length === 0 ? 'none' : regressions.join(', ')}`);
    return `${lines.join('\n')}\n`;
}
export function formatRefusal(result) {
    return `${result.refusals.map((r) => `Refused: ${r.message}`).join('\n')}\n`;
}
