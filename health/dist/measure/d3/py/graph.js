import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPythonImports } from '../../../python/imports.js';
import { trackedPaths } from '../../../scope/tracked.js';
import { createWorkCopy } from '../../../tools/workcopy.js';
import { failureReason } from '../../../tools/outcome.js';
import { edgeKey } from '../types.js';
import { presetContracts } from './contracts.js';
import { declaredDomainModules, domainFilesOf, isImpure } from './domain.js';
import { classifyPython } from './layers.js';
import { pyInterpreter } from './interpreter.js';
import { rootPackageDir } from './roots.js';
const TOOL = 'import-linter';
const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'python', 'graph_helper.py');
async function runHelper(ctx, unit, contracts, tool, interpreter) {
    const tracked = trackedPaths(ctx.repoPath);
    const dirs = unit.roots.map((r) => `${rootPackageDir(r)}/`);
    const files = tracked.filter((p) => p.endsWith('.py') && dirs.some((d) => p.startsWith(d)) && existsSync(path.join(ctx.repoPath, p)));
    if (unit.declared !== undefined && existsSync(path.join(ctx.repoPath, unit.declared.file)))
        files.push(unit.declared.file);
    const scratch = await mkdtemp(path.join(tmpdir(), 'health-d3py-'));
    let copy;
    try {
        copy = await createWorkCopy(ctx.repoPath, [...new Set(files)]);
        const input = {
            workDir: copy.dir,
            roots: unit.roots,
            declared: unit.declared === undefined ? null : path.join(copy.dir, unit.declared.file),
            contracts,
        };
        const inFile = path.join(scratch, 'in.json');
        const outFile = path.join(scratch, 'out.json');
        await writeFile(inFile, JSON.stringify(input));
        const runTool = { ...tool, command: interpreter, prefixArgs: ['-I', helperPath] };
        const result = await ctx.tools.run(runTool, ['--in', inFile, '--out', outFile], { cwd: copy.dir });
        const failure = failureReason(tool, result, [0]);
        if (failure !== null)
            return { unavailable: `${TOOL} failed: ${failure}` };
        let output;
        try {
            output = JSON.parse(await readFile(outFile, 'utf8'));
        }
        catch {
            return { unavailable: `${TOOL} failed: unreadable output` };
        }
        if (output.error !== undefined)
            return { unavailable: `${TOOL} failed: ${output.error}` };
        return { output };
    }
    catch (err) {
        return { unavailable: `${TOOL} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    finally {
        await copy?.cleanup();
        await rm(scratch, { recursive: true, force: true });
    }
}
function statementsByLine(info) {
    const out = new Map();
    for (const statement of info?.imports ?? []) {
        const list = out.get(statement.line) ?? [];
        list.push(statement);
        out.set(statement.line, list);
    }
    return out;
}
/** Runtime: at least one occurrence line maps to a statement that is neither lazy nor type-only; a line with no statement counts. */
export function isRuntime(info, lines) {
    if (lines.length === 0)
        return true;
    const byLine = statementsByLine(info);
    return lines.some((line) => {
        const statements = byLine.get(line);
        return statements === undefined || statements.some((s) => !s.lazy && !s.typeOnly);
    });
}
export function allTypeOnly(info, lines) {
    if (lines.length === 0)
        return false;
    const byLine = statementsByLine(info);
    return lines.every((line) => {
        const statements = byLine.get(line);
        return statements !== undefined && statements.length > 0 && statements.every((s) => s.typeOnly);
    });
}
export function externalTypeOnly(info, name) {
    const matching = (info?.imports ?? []).filter((s) => s.level === 0 && s.modules.some((m) => m === name || m.startsWith(`${name}.`)));
    return matching.length > 0 && matching.every((s) => s.typeOnly);
}
export async function buildPyGraph(ctx, units) {
    const tool = await ctx.tools.resolve(TOOL);
    if (tool === undefined)
        return { unavailable: ctx.tools.notFoundReason(TOOL) };
    const found = pyInterpreter(tool);
    if ('unavailable' in found)
        return found;
    ctx.tools.recordVersion(TOOL, tool.version);
    const imports = await readPythonImports(ctx);
    const tracked = new Set(trackedPaths(ctx.repoPath));
    const warnings = [];
    const result = [];
    const scoped = new Map();
    for (const file of ctx.scope.files)
        if (file.group === 'python')
            scoped.set(file.path, file);
    for (const unit of units) {
        const unitPaths = unit.files.map((f) => f.path);
        const unitFiles = new Set(unitPaths);
        const logicFiles = unit.logic.map((f) => f.path).sort();
        for (const file of unitPaths) {
            if (imports[file]?.syntaxError)
                warnings.push(`${file}: syntax error, its imports are not counted`);
        }
        // Barrels (`__init__.py` that only re-export) are not scoped files but are the canonical public entries, as for
        // TypeScript: module and entry classification covers every tracked Python file below the root packages.
        const rootDirs = unit.roots.map((r) => `${rootPackageDir(r)}/`);
        const graphPaths = [...new Set([...unitPaths, ...[...tracked].filter((p) => p.endsWith('.py') && rootDirs.some((d) => p.startsWith(d)))])].sort();
        const graphFiles = new Set(graphPaths);
        const classification = classifyPython(unit.preset, graphPaths, unit.package, unit.roots, tracked);
        const layerFiles = new Map();
        for (const [file, layers] of classification.layers) {
            for (const layer of layers) {
                const set = layerFiles.get(layer) ?? new Set();
                set.add(file);
                layerFiles.set(layer, set);
            }
        }
        const preset = unit.declared === undefined
            ? presetContracts(unit.package, unit.preset.rules, layerFiles, unitPaths, unit.roots)
            : { contracts: [], meta: new Map() };
        let output = {};
        if (unit.roots.length > 0) {
            const run = await runHelper(ctx, unit, preset.contracts, tool, found.interpreter);
            if ('unavailable' in run)
                return run;
            output = run.output;
            if (output.versions?.grimp !== undefined)
                ctx.tools.recordVersion('grimp', output.versions.grimp);
            if (output.versions?.['import-linter'] !== undefined)
                ctx.tools.recordVersion(TOOL, output.versions['import-linter']);
            for (const skipped of output.skipped ?? [])
                warnings.push(`${unit.package}: ${TOOL} contract ${skipped.contract} skipped (${skipped.reason})`);
        }
        const edgeLines = new Map();
        const edges = [];
        for (const edge of output.edges ?? []) {
            if (!unitFiles.has(edge.from) || !unitFiles.has(edge.to) || edge.from === edge.to)
                continue;
            edgeLines.set(edgeKey(edge.from, edge.to), edge.lines);
            edges.push({ from: edge.from, to: edge.to, fromTest: scoped.get(edge.from)?.role === 'test', runtime: isRuntime(imports[edge.from], edge.lines) });
        }
        edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
        const violating = new Set();
        const violationRules = {};
        for (const violation of output.violations ?? []) {
            if (!unitFiles.has(violation.importer) || scoped.get(violation.importer)?.role === 'test')
                continue;
            if (!violation.external && (!unitFiles.has(violation.imported) || violation.imported === violation.importer))
                continue;
            const info = preset.meta.get(violation.contract);
            if (info !== undefined && !violation.external) {
                const from = classification.layerModule.get(violation.importer);
                if (from !== undefined && from === classification.layerModule.get(violation.imported))
                    continue;
            }
            if (info?.excludesTypeOnly) {
                const typeOnly = violation.external
                    ? externalTypeOnly(imports[violation.importer], violation.imported)
                    : allTypeOnly(imports[violation.importer], edgeLines.get(edgeKey(violation.importer, violation.imported)) ?? []);
                if (typeOnly)
                    continue;
            }
            const key = edgeKey(violation.importer, violation.imported);
            violating.add(key);
            const names = (violationRules[key] ??= []);
            const label = info?.rule ?? violation.contract;
            if (!names.includes(label))
                names.push(label);
        }
        for (const names of Object.values(violationRules))
            names.sort();
        const moduleDirsOfUnit = new Set(logicFiles.map((f) => classification.moduleOf.get(f)).filter((m) => m !== undefined));
        const crossings = [];
        if (moduleDirsOfUnit.size >= 2) {
            for (const edge of output.edges ?? []) {
                if (!unitFiles.has(edge.from) || scoped.get(edge.from)?.role === 'test' || !graphFiles.has(edge.to) || edge.from === edge.to)
                    continue;
                const fromModule = classification.moduleOf.get(edge.from);
                const toModule = classification.moduleOf.get(edge.to);
                if (fromModule === undefined || toModule === undefined || fromModule === toModule)
                    continue;
                crossings.push({ from: edge.from, to: edge.to, toEntry: classification.entries.has(edge.to) });
            }
            crossings.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
        }
        const declaredModules = unit.declared === undefined ? [] : declaredDomainModules(unit.declared.contracts);
        const domainFiles = domainFilesOf(logicFiles, unit.roots, declaredModules);
        const impure = domainFiles.filter((file) => isImpure(imports[file], edges.filter((e) => e.from === file).map((e) => e.to), ctx.methodology.d3));
        result.push({
            ...unit.rules,
            logicFiles,
            edges,
            violating: [...violating].sort(),
            violationRules,
            moduleCount: moduleDirsOfUnit.size,
            crossings,
            domain: { files: domainFiles, impure },
        });
    }
    return { units: result, warnings };
}
