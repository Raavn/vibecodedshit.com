import { spawnSync } from 'node:child_process';
import path from 'node:path';
const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
const defaultCache = new Map();
/** The target of `origin/HEAD` with `origin/` removed (when present), plus `main` and `master`. */
export function defaultBranchNames(repoPath) {
    const key = path.resolve(repoPath);
    const cached = defaultCache.get(key);
    if (cached)
        return cached;
    const result = spawnSync('git', ['-C', key, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { encoding: 'utf8' });
    const head = result.error || result.status !== 0 ? '' : result.stdout.trim().replace(/^origin\//, '');
    const names = [...new Set([...(head === '' ? [] : [head]), 'main', 'master'])];
    defaultCache.set(key, names);
    return names;
}
export function resetDefaultBranchCache() {
    defaultCache.clear();
}
const yes = (why) => ({ qualifies: true, why });
const no = (why) => ({ qualifies: false, why });
function github(doc, defaults) {
    const on = doc.on ?? doc.true;
    const events = new Map();
    if (typeof on === 'string')
        events.set(on, null);
    else if (Array.isArray(on))
        for (const e of list(on))
            events.set(e, null);
    else if (isObj(on))
        for (const [event, value] of Object.entries(on))
            events.set(event, value);
    for (const event of ['pull_request', 'pull_request_target'])
        if (events.has(event))
            return yes(event);
    if (events.has('push')) {
        const push = events.get('push');
        return pushFilter(isObj(push) ? push : {}, defaults);
    }
    return no(events.size === 0 ? 'no triggers' : `only ${[...events.keys()].join(', ')}`);
}
function pushFilter(push, defaults) {
    if (push['branches-ignore'] !== undefined)
        return yes('push, branches-ignore');
    if (push.branches !== undefined) {
        const branches = list(push.branches);
        return branches.length === 0 || branches.some((b) => !defaults.includes(b)) ? yes('push to non-default branches') : no('push limited to the default branch');
    }
    if (push.tags !== undefined || push['tags-ignore'] !== undefined)
        return no('push of tags only');
    return yes('push, no filter');
}
function limitedToDefault(expression, defaults) {
    if (/merge_request_event|CI_MERGE_REQUEST/.test(expression))
        return false;
    const names = defaults.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return new RegExp(`^\\s*\\$CI_(?:COMMIT_BRANCH|COMMIT_REF_NAME)\\s*==\\s*(["']?)(?:\\$CI_DEFAULT_BRANCH|${names})\\1\\s*$`).test(expression);
}
function gitlab(doc, jobName, defaults) {
    const job = doc[jobName];
    if (!isObj(job))
        return yes('not a job table');
    if (Array.isArray(job.rules)) {
        for (const rule of job.rules) {
            if (!isObj(rule))
                continue;
            if (typeof rule.if === 'string') {
                if (rule.when === 'never')
                    continue;
                if (!limitedToDefault(rule.if, defaults))
                    return yes('rule not limited to the default branch');
            }
            else if (rule.when !== 'never')
                return yes('rule without a condition');
        }
        return no('rules limited to the default branch');
    }
    const only = job.only;
    if (only !== undefined) {
        const refs = isObj(only) ? list(only.refs) : list(only);
        if (refs.some((r) => r === 'merge_requests' || r === 'branches'))
            return yes('only merge_requests or branches');
        return refs.length === 0 || refs.some((r) => !defaults.includes(r)) ? yes('only other refs') : no('only the default branch');
    }
    return yes('no rules or only: every branch push');
}
function circleci(doc, jobName, defaults) {
    if (!isObj(doc.workflows))
        return yes('no workflows key');
    for (const [name, workflow] of Object.entries(doc.workflows)) {
        if (!isObj(workflow))
            continue;
        const triggers = Array.isArray(workflow.triggers) ? workflow.triggers : [];
        if (triggers.some((t) => isObj(t) && t.schedule !== undefined))
            continue;
        for (const entry of Array.isArray(workflow.jobs) ? workflow.jobs : []) {
            const [key, value] = typeof entry === 'string' ? [entry, null] : isObj(entry) ? (Object.entries(entry)[0] ?? ['', null]) : ['', null];
            const alias = isObj(value) && typeof value.name === 'string' ? value.name : key;
            if (key !== jobName && alias !== jobName)
                continue;
            const only = isObj(value) && isObj(value.filters) && isObj(value.filters.branches) ? list(value.filters.branches.only) : [];
            if (only.length === 0 || only.some((b) => !defaults.includes(b)))
                return yes(`workflow ${name}`);
        }
    }
    return no('in no qualifying workflow');
}
function bitbucket(section, doc, defaults) {
    if (section === 'default' || section === 'pull-requests')
        return yes(section);
    if (section === 'branches') {
        const pipelines = isObj(doc.pipelines) ? doc.pipelines : {};
        const keys = isObj(pipelines.branches) ? Object.keys(pipelines.branches) : [];
        return keys.length === 0 || keys.some((k) => !defaults.includes(k)) ? yes('branches other than the default') : no('branches limited to the default branch');
    }
    return no(`${section} pipelines`);
}
function azure(doc, defaults) {
    const pr = doc.pr;
    if (pr !== undefined && pr !== 'none' && pr !== null)
        return yes('pr trigger');
    const trigger = doc.trigger;
    if (trigger === undefined)
        return yes('no trigger: CI on all branches');
    if (trigger === 'none')
        return no('trigger: none');
    const include = isObj(trigger) ? (isObj(trigger.branches) ? list(trigger.branches.include) : list(trigger.include)) : list(trigger);
    return include.length === 0 || include.some((b) => !defaults.includes(b)) ? yes('trigger on other branches') : no('trigger limited to the default branch');
}
/**
 * Whether a CI job runs on pull requests, merge requests or non-default pushes. A job is excluded only when it is positively
 * identified as not triggered that way; a filter that cannot be read statically qualifies.
 */
export function triggersFor(format, doc, jobName, repoPath) {
    if (!isObj(doc))
        return yes('unreadable');
    const defaults = defaultBranchNames(repoPath);
    switch (format) {
        case 'github':
            return github(doc, defaults);
        case 'gitlab':
            return gitlab(doc, jobName, [...defaults, '$CI_DEFAULT_BRANCH']);
        case 'circleci':
            return circleci(doc, jobName, defaults);
        case 'bitbucket':
            return bitbucket(jobName, doc, defaults);
        case 'azure':
            return azure(doc, defaults);
    }
}
