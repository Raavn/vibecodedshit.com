export const SCARE_LIMIT = 3;
export const NO_SCARES = 'Nothing in the checks below is a scare. The scan looks at committed secrets and known advisories, not access rules, so this is not a clean bill of health.';
const records = (value) => Array.isArray(value) ? value.filter((v) => typeof v === 'object' && v !== null) : null;
const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
const SEVERITY_RANK = { critical: 4, high: 3, moderate: 2, low: 1 };
const measured = (param) => param?.status === 'measured';
function levels(param) {
    if (!measured(param))
        return [];
    const fromRaw = param.raw?.kind === 'level' ? [param.raw.level] : [];
    return [...fromRaw, ...(param.units ?? []).flatMap((u) => (u.raw.kind === 'level' ? [u.raw.level] : []))];
}
function secretScares(run, param) {
    if (!measured(param))
        return [];
    const only = run.reportOnly ?? {};
    const tree = records(only.secretsInTree) ?? [];
    const scares = [];
    if (tree.some((f) => f.supabaseRole === 'service_role')) {
        scares.push('Anyone with access to your git repo can read and change all the data in your Supabase.');
    }
    // A Supabase anon key is public by design, so it is not a leaked secret.
    const others = tree.filter((f) => f.supabaseRole !== 'service_role' && f.supabaseRole !== 'anon');
    const first = others[0];
    if (first) {
        const more = others.length > 1 ? ` (${others.length} secrets in all)` : '';
        scares.push(`Anyone with access to your git repo can use a secret committed in ${text(first.file)} (${text(first.ruleId)})${more}.`);
    }
    return scares;
}
function dependencyScare(run, param) {
    if (!measured(param) || (param.score ?? 100) > 50)
        return [];
    const advisories = records(run.reportOnly?.productionDependencyVulnerabilities?.advisories) ?? [];
    const worst = [...advisories].sort((a, b) => (SEVERITY_RANK[text(b.severity)] ?? 0) - (SEVERITY_RANK[text(a.severity)] ?? 0))[0];
    const detail = worst
        ? ` (${advisories.length} known ${advisories.length === 1 ? 'advisory' : 'advisories'}, the worst in ${text(worst.name)} ${text(worst.version)})`
        : '';
    return [`Your live app runs on dependencies with publicly known security holes${detail}.`];
}
function historyScare(run, param) {
    if (!measured(param))
        return [];
    const history = records(run.reportOnly?.secretsInHistory?.findings) ?? [];
    const inTree = new Set((records(run.reportOnly?.secretsInTree) ?? []).map((f) => `${text(f.file)}\0${text(f.ruleId)}`));
    const gone = history.filter((f) => !inTree.has(`${text(f.file)}\0${text(f.ruleId)}`));
    if (gone.length === 0)
        return [];
    return [`Deleting a key from the code did not kill it: ${gone.length === 1 ? 'a secret is' : `${gone.length} secrets are`} still readable in your git history.`];
}
/**
 * The scares in severity order: plain-English consequences, not metrics. Only measured or failed parameters trigger
 * one, so a preview simply has fewer. Never padded. Report only, never scored.
 */
export function buildScares(run) {
    if (!run.valid)
        return [];
    const param = (id) => run.parameters.find((p) => p.id === id);
    const scoreOf = (id) => {
        const p = param(id);
        return p && (p.status === 'measured' || p.status === 'failed') ? (p.status === 'failed' ? 0 : (p.score ?? 0)) : null;
    };
    const scares = [...secretScares(run, param('5.4')), ...dependencyScare(run, param('5.1')), ...historyScare(run, param('5.4'))];
    if (levels(param('6.1')).some((l) => l === 'install_fails' || l === 'build_fails')) {
        scares.push("A clean copy of this code doesn't install or build.");
    }
    if (scoreOf('1.1') === 0 || scoreOf('1.2') === 0)
        scares.push('Nothing checks your changes, so your users find the breakage first.');
    if (levels(param('5.3')).includes('none'))
        scares.push('Two installs of the same commit can ship different code.');
    if (scoreOf('6.4') === 0)
        scares.push('Nothing stops broken code from reaching main.');
    return scares.slice(0, SCARE_LIMIT);
}
/** What the scan could not check, named so an empty list is not read as clean. */
export function unchecked(run) {
    const names = [['5.4', 'secrets'], ['5.1', 'dependency advisories']];
    return names.filter(([id]) => !run.parameters.some((p) => p.id === id && (p.status === 'measured' || p.status === 'failed'))).map(([, name]) => name);
}
/** The lines `health report` prints after the Roadmap lines: `Scare: <text>`. */
export function scareLines(run) {
    return buildScares(run).map((s) => `Scare: ${s}`);
}
