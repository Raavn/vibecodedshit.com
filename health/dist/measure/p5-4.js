import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packageOf } from '../scope/packages.js';
import { trackedPaths } from '../scope/tracked.js';
import { failureReason, unavailable } from '../tools/outcome.js';
import { createWorkCopy } from '../tools/workcopy.js';
import { scopeUnits } from './deps/units.js';
function parseFindings(text) {
    if (text.trim() === '' || text.trim() === 'null')
        return [];
    try {
        const json = JSON.parse(text);
        return Array.isArray(json) ? json : undefined;
    }
    catch {
        return undefined;
    }
}
function relative(file, root) {
    const posix = file.split(path.sep).join('/');
    const rootPosix = root.split(path.sep).join('/');
    const rel = posix.startsWith(`${rootPosix}/`) ? posix.slice(rootPosix.length + 1) : posix;
    return path.posix.normalize(rel).replace(/^\.\//, '');
}
async function scanWorkingTree(ctx, outDir, config) {
    const tool = await ctx.tools.resolve('gitleaks');
    if (!tool)
        return unavailable(ctx.tools.notFoundReason('gitleaks'));
    const copy = await createWorkCopy(ctx.repoPath, trackedPaths(ctx.repoPath));
    try {
        const report = path.join(outDir, 'tree.json');
        // --exit-code 0: any non-zero exit means gitleaks itself failed.
        const result = await ctx.tools.run(tool, ['dir', '.', '--config', config, '--report-format', 'json', '--report-path', report, '--exit-code', '0', '--redact', '--no-banner'], { cwd: copy.dir });
        const failure = failureReason(tool, result, [0]);
        if (failure)
            return unavailable(failure);
        let text;
        try {
            text = await readFile(report, 'utf8');
        }
        catch {
            return unavailable('gitleaks wrote no report');
        }
        const findings = parseFindings(text);
        if (!findings)
            return unavailable('gitleaks printed no parseable JSON report');
        return findings.map((f) => ({ ...f, File: typeof f.File === 'string' ? relative(f.File, copy.dir) : f.File }));
    }
    finally {
        await copy.cleanup();
    }
}
/** Report only: a failure is a warning and never makes the parameter not_measured. */
async function scanHistory(ctx, outDir, config) {
    const tool = await ctx.tools.resolve('gitleaks');
    if (!tool)
        return null;
    const report = path.join(outDir, 'history.json');
    const result = await ctx.tools.run(tool, ['git', path.resolve(ctx.repoPath), '--config', config, '--report-format', 'json', '--report-path', report, '--exit-code', '0', '--redact', '--no-banner'], { cwd: outDir });
    if (failureReason(tool, result, [0]) !== null)
        return null;
    let findings;
    try {
        findings = parseFindings(await readFile(report, 'utf8'));
    }
    catch {
        return null;
    }
    if (!findings)
        return null;
    return {
        count: findings.length,
        findings: findings.map((f) => ({ ruleId: f.RuleID, file: f.File, commit: f.Commit, line: f.StartLine })),
    };
}
export const p54 = {
    id: '5.4',
    layer: 'static',
    async measure(ctx) {
        const outDir = await mkdtemp(path.join(tmpdir(), 'health-gitleaks-'));
        try {
            // An explicit config: the pinned default ruleset applies and no .gitleaks.toml is read.
            const config = path.join(outDir, 'gitleaks.toml');
            await writeFile(config, '[extend]\nuseDefault = true\n');
            const findings = await scanWorkingTree(ctx, outDir, config);
            if (!Array.isArray(findings))
                return findings;
            const units = scopeUnits(ctx);
            const counts = new Map(units.map((u) => [`${u.package}\0${u.group}`, 0]));
            for (const finding of findings) {
                if (typeof finding.File !== 'string')
                    continue;
                const owner = packageOf(finding.File, ctx.scope.packages);
                const owned = units.filter((u) => u.package === owner);
                for (const unit of owned.length > 0 ? owned : units) {
                    const key = `${unit.package}\0${unit.group}`;
                    counts.set(key, (counts.get(key) ?? 0) + 1);
                }
            }
            const warnings = [];
            const history = await scanHistory(ctx, outDir, config);
            if (history === null)
                warnings.push('5.4: git history scan failed');
            const result = units.map((u) => ({
                package: u.package,
                group: u.group,
                weight: u.weight,
                raw: { kind: 'number', value: counts.get(`${u.package}\0${u.group}`) ?? 0 },
            }));
            return {
                status: 'measured',
                units: result,
                warnings,
                ...(history === null ? {} : { reportOnly: { secretsInHistory: history } }),
            };
        }
        finally {
            await rm(outDir, { recursive: true, force: true });
        }
    },
};
