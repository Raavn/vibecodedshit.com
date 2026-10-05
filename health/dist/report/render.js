import { SHALLOW_WARNING } from '../report-only/hotspots.js';
import { escapeHtml as e } from './escape.js';
import { nearestDescriptor, rawText, scoreText, statusText } from './format.js';
import { STYLE } from './style.js';
const NOT_COLLECTED = '<p class="muted">not collected</p>';
function table(head, rows) {
    const th = head.map((h) => `<th${h.num ? ' class="num"' : ''}>${e(h.text)}</th>`).join('');
    const body = rows
        .map((row) => `<tr>${row.map((cell, i) => `<td${head[i]?.num ? ' class="num"' : ''}>${cell}</td>`).join('')}</tr>`)
        .join('\n');
    return `<table><thead><tr>${th}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}
function asRecords(value) {
    if (!Array.isArray(value))
        return null;
    return value.filter((v) => typeof v === 'object' && v !== null);
}
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
function header(run, methodology) {
    const parts = ['<h1>Codebase health report</h1>'];
    parts.push(`<p class="muted">${e(run.repo.path)} · ${run.repo.headCommit ? `commit <code>${e(run.repo.headCommit.slice(0, 12))}</code> · ` : ''}as of ${e(run.asOf)} · methodology ${e(run.methodology.version)} · ${e(run.mode)} run</p>`);
    if (run.mode === 'preview' || !run.comparable) {
        parts.push(`<p><span class="label">${e(run.comparableReason ?? 'preview, not comparable')}</span></p>`);
    }
    if (run.health) {
        const band = methodology.bands.find((b) => b.key === run.health?.band);
        parts.push(`<div class="health"><span class="score">${e(run.health.displayed)}</span><span class="band">${e(band?.name ?? run.health.band)}</span></div>`, `<p>${e(band?.meaning?.replace(/\s+/g, ' ').trim() ?? '')}</p>`);
    }
    else {
        parts.push('<p class="muted">no health score</p>');
    }
    return parts.join('\n');
}
function dimensionsSection(run, methodology) {
    const rows = methodology.dimensions.map((def) => {
        const score = run.dimensions.find((d) => d.id === def.id)?.score ?? null;
        return [e(`${def.id}`), e(def.name), score === null ? '<span class="muted">not scored</span>' : e(scoreText(score))];
    });
    return `<h2>Dimensions</h2>\n${table([{ text: '#' }, { text: 'Dimension' }, { text: 'Score', num: true }], rows)}`;
}
function parametersSection(run, methodology) {
    const defs = new Map(methodology.dimensions.flatMap((d) => d.parameters).map((p) => [p.id, p]));
    const rows = run.parameters.map((param) => {
        const def = defs.get(param.id);
        const status = `<span class="status-${e(param.status)}">${e(statusText(param.status))}</span>${param.reason ? ` <span class="muted">(${e(param.reason)})</span>` : ''}`;
        const scored = param.status === 'measured' || param.status === 'failed';
        const raw = def && param.status === 'measured' ? e(rawText(param, def)) : '–';
        const descriptor = def && param.status === 'measured' && param.score !== undefined ? nearestDescriptor(def, param.score) : null;
        return [e(param.id), e(def?.name ?? param.id), raw, scored ? e(scoreText(param.score)) : '–', status, descriptor ? e(descriptor) : '–'];
    });
    return `<h2>Parameters</h2>\n${table([{ text: 'ID' }, { text: 'Parameter' }, { text: 'Raw value' }, { text: 'Score', num: true }, { text: 'Status' }, { text: 'Nearest anchor' }], rows)}`;
}
function breakdownTable(title, byKey, methodology) {
    const keys = Object.keys(byKey).sort();
    if (keys.length === 0)
        return `<h3>${e(title)}</h3>\n<p class="muted">no units</p>`;
    const head = [{ text: title.replace(/^By /, '') }, ...methodology.dimensions.map((d) => ({ text: `${d.id} ${d.name}`, num: true }))];
    const rows = keys.map((key) => [
        `<code>${e(key)}</code>`,
        ...methodology.dimensions.map((d) => e(scoreText(byKey[key]?.[String(d.id)]))),
    ]);
    return `<h3>${e(title)}</h3>\n${table(head, rows)}`;
}
function breakdownSection(run, methodology) {
    return `<h2>Breakdown</h2>\n${breakdownTable('By package', run.breakdown.byPackage, methodology)}\n${breakdownTable('By language group', run.breakdown.byGroup, methodology)}`;
}
function excludedSection(run) {
    return `<h2>Excluded lines</h2>\n<p>${e(run.ignoreSet.excludedLinesPercent)}% of lines excluded by .healthignore</p>`;
}
function secretsHtml(value) {
    const record = typeof value === 'object' && value !== null ? value : null;
    const findings = asRecords(record?.findings);
    if (!findings)
        return NOT_COLLECTED;
    if (findings.length === 0)
        return '<p class="muted">none found</p>';
    return table([{ text: 'Rule' }, { text: 'File' }, { text: 'Commit' }], findings.map((f) => [e(str(f.ruleId)), `<code>${e(str(f.file))}</code>`, `<code>${e(str(f.commit).slice(0, 8))}</code>`]));
}
function vulnerabilitiesHtml(value) {
    const record = typeof value === 'object' && value !== null ? value : null;
    const advisories = asRecords(record?.advisories);
    if (!advisories)
        return NOT_COLLECTED;
    if (advisories.length === 0)
        return '<p class="muted">none found</p>';
    return table([{ text: 'Package' }, { text: 'Advisory' }, { text: 'Severity' }], advisories.map((a) => [`<code>${e(str(a.name))}</code>`, e(str(a.id)), e(str(a.severity))]));
}
function reportOnlySection(run) {
    const only = run.reportOnly ?? {};
    return [
        '<h2>Report-only items</h2>',
        '<p class="muted">These never change a score.</p>',
        '<h3>Secrets in git history</h3>',
        secretsHtml(only.secretsInHistory),
        '<h3>Development-dependency vulnerabilities</h3>',
        vulnerabilitiesHtml(only.devDependencyVulnerabilities),
    ].join('\n');
}
function hotspotsSection(run) {
    const hotspots = asRecords(run.reportOnly?.hotspots);
    const parts = ['<h2>Fix these first</h2>', '<p class="muted">Files ranked by commits in the last 12 months times cognitive complexity.</p>'];
    if (run.warnings.includes(SHALLOW_WARNING))
        parts.push(`<p class="note">${e(SHALLOW_WARNING)}</p>`);
    if (!hotspots)
        parts.push(NOT_COLLECTED);
    else if (hotspots.length === 0)
        parts.push('<p class="muted">no file has both churn and complexity</p>');
    else {
        parts.push(table([{ text: 'File' }, { text: 'Commits', num: true }, { text: 'Complexity', num: true }, { text: 'Score', num: true }], hotspots.map((h) => [`<code>${e(str(h.path))}</code>`, e(str(h.churn)), e(str(h.complexity)), e(str(h.score))])));
    }
    return parts.join('\n');
}
/** One self-contained HTML document. Inline CSS, no script, no external reference, no clock value. */
export function renderReport(run, methodology) {
    const sections = [
        header(run, methodology),
        dimensionsSection(run, methodology),
        parametersSection(run, methodology),
        breakdownSection(run, methodology),
        excludedSection(run),
        reportOnlySection(run),
        hotspotsSection(run),
    ];
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codebase health report</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${sections.join('\n')}
</main>
</body>
</html>
`;
}
