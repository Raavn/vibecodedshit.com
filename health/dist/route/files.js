import { nearestDescriptor, rawText } from '../report/format.js';
import { outOfReachLine } from './select.js';
export const FACTS_START = '<!-- health:facts:start -->';
export const FACTS_END = '<!-- health:facts:end -->';
export const TASK_PLACEHOLDER = '<!-- health:task -->';
export const ROUTE_FILE = 'ROUTE.md';
export const SLICE_FILE = /^\d{2}-.+\.md$/;
const WHERE_LIMIT = 10;
const kebab = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function sliceFileName(slice) {
    return `${String(slice.position).padStart(2, '0')}-${slice.id.replace('.', '-')}-${kebab(slice.name)}.md`;
}
function whereLines(run, slice, param) {
    const units = [...(param?.units ?? [])]
        .sort((a, b) => a.score - b.score || a.package.localeCompare(b.package) || a.group.localeCompare(b.group))
        .slice(0, WHERE_LIMIT)
        .map((u) => `- package \`${u.package}\` (${u.group}), score ${Math.round(u.score)}`);
    const hotspots = slice.id === '4.1' && Array.isArray(run.reportOnly?.hotspots)
        ? run.reportOnly.hotspots
            .flatMap((h) => (typeof h === 'object' && h !== null && typeof h.path === 'string' ? [h.path] : []))
            .slice(0, WHERE_LIMIT)
            .map((file) => `- file \`${file}\` (hotspot)`)
        : [];
    const lines = [...units, ...hotspots];
    return lines.length > 0 ? lines : ['- the whole repository'];
}
function sliceFacts(run, def, slice) {
    const param = run.parameters.find((p) => p.id === slice.id);
    const current = param?.status === 'measured' ? rawText(param, def) : 'no usable result';
    const nearest = nearestDescriptor(def, slice.fromScore);
    return [
        FACTS_START,
        `**Goal:** Raise ${slice.id} ${slice.name} from ${Math.round(slice.fromScore)} to ${Math.round(slice.toScore)}: "${slice.descriptor}"`,
        '',
        `**Why:** Today it is ${current} (score ${Math.round(slice.fromScore)})${nearest ? `, which the methodology describes as "${nearest}"` : ''}.`,
        '',
        '**Where:**',
        ...whereLines(run, slice, param),
        '',
        `**Health effect:** health ${slice.healthBefore} -> ${slice.healthAfter} once this Slice and the ones before it are done.`,
        '',
        `**Done when:** re-running /codebase-health shows ${slice.id} ${slice.name} at ${Math.round(slice.toScore)} or higher ("${slice.descriptor}").`,
        '',
        '**Rules:** Raise the score by changing the code, not the measurement. Do not edit .healthignore, .gitleaksignore, lint, type or test configuration to hide findings, and do not delete, skip or weaken tests.',
        FACTS_END,
    ].join('\n');
}
function sliceFile(run, methodology, slice) {
    const def = methodology.dimensions.flatMap((d) => d.parameters).find((p) => p.id === slice.id);
    if (!def)
        throw new Error(`No parameter ${slice.id} in the methodology`);
    const fixed = `# ${String(slice.position).padStart(2, '0')}. ${slice.id} ${slice.name}\n\n${sliceFacts(run, def, slice)}\n\n## Task\n`;
    return { name: sliceFileName(slice), fixed, content: `${fixed}\n${TASK_PLACEHOLDER}\n` };
}
function routeIndex(plan) {
    const lines = [`# Route to ${plan.target.name}`, '', `${plan.slices.length} Slices take health from ${plan.from} to ${plan.to}. Hand them to your agent one at a time, in this order, as a goal each.`];
    if (!plan.reached)
        lines.push('', outOfReachLine(plan));
    if (plan.unmeasured.length > 0)
        lines.push('', `Not measured in this run, so this Route leaves them out: ${plan.unmeasured.join(', ')}.`);
    if (plan.slices.length > 0) {
        lines.push('', '| # | Slice | Health after |', '| --- | --- | --- |');
        for (const slice of plan.slices)
            lines.push(`| ${slice.position} | [${slice.id} ${slice.name}](${sliceFileName(slice)}) | ${slice.healthAfter} |`);
    }
    const text = `${lines.join('\n')}\n`;
    return { name: ROUTE_FILE, fixed: text, content: text };
}
/** ROUTE.md and one file per Slice, the same on every call for the same run.json. Empty unless the plan is a Route. */
export function buildRouteFiles(run, methodology, plan) {
    if (plan.kind !== 'route')
        return [];
    return [routeIndex(plan), ...plan.slices.map((slice) => sliceFile(run, methodology, slice))];
}
