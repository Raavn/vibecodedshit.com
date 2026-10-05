import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createDockerRunner, imageDigest } from '../exec/docker.js';
import { runExecution } from '../exec/run.js';
import { feedbackLoop } from '../measure/p6-3.js';
import { measurers as allMeasurers } from '../measure/registry.js';
import { computeHotspots } from '../report-only/hotspots.js';
import { loadMethodology, packageRoot } from '../methodology/load.js';
import { buildScope } from '../scope/build.js';
import { poolParameter } from '../scoring/pool.js';
import { createToolKit } from '../tools/kit.js';
import { breakdownFor, dimensionScores, healthFrom } from './score-run.js';
export class NoLogicFilesError extends Error {
    constructor() {
        super('The repository has no logic file, so it is not scored');
        this.name = 'NoLogicFilesError';
    }
}
function git(repoPath, args) {
    const result = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
    return result.error || result.status !== 0 ? null : result.stdout.trim();
}
function healthVersion() {
    const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    return pkg.version;
}
function baseRun(opts) {
    const repoPath = path.resolve(opts.repoPath);
    const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.trim().replace(/^git version /, '');
    return {
        schemaVersion: 1,
        valid: true,
        warnings: [],
        methodology: { version: opts.methodologyVersion },
        mode: opts.mode,
        comparable: false,
        comparableReason: 'preview, not comparable',
        asOf: opts.asOf,
        layers: ['static'],
        repo: {
            path: repoPath,
            headCommit: git(repoPath, ['rev-parse', '--verify', '-q', 'HEAD']),
            treeHash: git(repoPath, ['rev-parse', '--verify', '-q', 'HEAD^{tree}']),
        },
        tools: { health: healthVersion(), node: process.version, typescript: ts.version, git: gitVersion },
    };
}
/** A run for a tool error: marked invalid, with no scores and no health. */
export function invalidRun(opts, reason) {
    return {
        ...baseRun(opts),
        valid: false,
        invalidReason: reason,
        ignoreSet: { healthignoreSha256: null, gitleaksignoreSha256: null, excludedLinesPercent: 0 },
        scope: { logicFiles: 0, logicLines: 0, sourceLines: 0, packages: [] },
        parameters: [],
        dimensions: [],
        breakdown: { byPackage: {}, byGroup: {} },
        health: null,
    };
}
export async function runScan(opts, preloaded) {
    const methodology = preloaded ?? loadMethodology(opts.methodologyVersion, opts.rootDir);
    const repoPath = path.resolve(opts.repoPath);
    const scope = await buildScope(repoPath, methodology);
    if (scope.logicFiles === 0)
        throw new NoLogicFilesError();
    let exec;
    if (opts.mode === 'full') {
        const tag = methodology.execution.runner.image;
        exec = await runExecution({
            repoPath,
            methodology,
            scope,
            runner: opts.execRunner ?? createDockerRunner(methodology.execution.runner),
            image: { tag, digest: opts.imageDigest ?? (await imageDigest(tag)) },
        });
    }
    const tools = opts.tools ?? createToolKit();
    const warnings = [...scope.warnings];
    const reportOnly = {};
    const parameters = [];
    for (const dimension of methodology.dimensions) {
        for (const def of dimension.parameters) {
            if (def.layer === 'execution' && opts.mode === 'preview') {
                parameters.push({
                    id: def.id,
                    status: 'not_measured',
                    reason: 'execution layer, not run in preview',
                    weight: def.weight,
                });
                continue;
            }
            const measurer = (opts.measurers ?? allMeasurers).find((m) => m.id === def.id);
            if (!measurer) {
                parameters.push({ id: def.id, status: 'not_measured', reason: 'not implemented yet', weight: def.weight });
                continue;
            }
            const measurement = await measurer.measure({
                methodology,
                param: def,
                scope,
                repoPath,
                asOf: opts.asOf,
                mode: opts.mode,
                tools,
                ...(exec ? { exec } : {}),
            });
            if (measurement.status === 'measured') {
                Object.assign(reportOnly, measurement.reportOnly);
                warnings.push(...(measurement.warnings ?? []));
                const pooled = poolParameter(def, measurement.units);
                parameters.push({
                    id: def.id,
                    status: 'measured',
                    weight: def.weight,
                    raw: pooled.raw,
                    score: pooled.score,
                    units: pooled.units,
                });
            }
            else if (measurement.status === 'not_measured') {
                parameters.push({ id: def.id, status: 'not_measured', reason: measurement.reason, weight: def.weight });
            }
            else if (measurement.status === 'failed') {
                parameters.push({ id: def.id, status: 'failed', reason: measurement.reason, weight: def.weight, score: 0 });
            }
            else {
                parameters.push({ id: def.id, status: 'not_applicable', reason: measurement.reason, weight: def.weight });
            }
        }
    }
    const complexityByFile = reportOnly.complexityByFile;
    if (Array.isArray(complexityByFile)) {
        const hotspots = computeHotspots(repoPath, opts.asOf, complexityByFile);
        reportOnly.hotspots = hotspots.hotspots;
        warnings.push(...hotspots.warnings);
    }
    const dimensions = dimensionScores(methodology, parameters);
    const base = baseRun(opts);
    const unmeasured = parameters.filter((p) => p.status === 'not_measured').map((p) => p.id);
    return {
        ...base,
        ...(opts.mode === 'full'
            ? {
                layers: ['static', 'execution'],
                comparable: unmeasured.length === 0,
                comparableReason: unmeasured.length === 0 ? 'all parameters measured' : `not comparable, not measured: ${unmeasured.join(', ')}`,
            }
            : {}),
        warnings,
        tools: {
            ...base.tools,
            ...(exec ? { image: exec.image } : {}),
            ...(scope.pythonVersion === undefined ? {} : { python: scope.pythonVersion }),
            ...(Object.keys(tools.versions()).length === 0 ? {} : { static: tools.versions() }),
        },
        ...(exec ? { execution: { feedbackLoop: feedbackLoop(exec) } } : {}),
        ...(Object.keys(reportOnly).length === 0 ? {} : { reportOnly }),
        ignoreSet: {
            healthignoreSha256: scope.healthignoreSha256,
            gitleaksignoreSha256: scope.gitleaksignoreSha256,
            excludedLinesPercent: scope.excludedLinesPercent,
        },
        scope: {
            logicFiles: scope.logicFiles,
            logicLines: scope.logicLines,
            sourceLines: scope.sourceLines,
            packages: scope.packages,
        },
        parameters,
        dimensions,
        breakdown: breakdownFor(methodology, parameters),
        health: healthFrom(methodology, dimensions),
    };
}
