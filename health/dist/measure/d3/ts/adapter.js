import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { classifyImports, hasUseClient } from './classify.js';
import { findDeclaredConfig } from './config.js';
import { isDomainFile, isImpure } from './domain.js';
import { presetRules } from './rules.js';
import { readPackageJson } from '../../../manifest/package-json.js';
import { trackedPaths } from '../../../scope/tracked.js';
import { ciInvokes } from '../../../scripts/expand.js';
import { nearestTsConfig } from '../../ts/tsconfig.js';
import { choosePreset, globLayers, globMatcher, moduleDirs, publicEntryGlob } from '../presets.js';
import { edgeKey } from '../types.js';
const GROUP = 'typescript_javascript';
const TOOL = 'dependency-cruiser';
function setup(ctx) {
    return ctx.tools.memo(`d3:ts:setup:${ctx.repoPath}`, async () => {
        const warnings = [];
        const tracked = new Set(trackedPaths(ctx.repoPath));
        const byPackage = new Map();
        for (const file of ctx.scope.files) {
            if (file.group !== GROUP)
                continue;
            const list = byPackage.get(file.package) ?? [];
            list.push(file);
            byPackage.set(file.package, list);
        }
        const ciHits = ciInvokes(ctx.repoPath, ['depcruise', 'dependency-cruiser'], { warnings });
        const configCache = new Map();
        const units = [];
        for (const [pkg, files] of [...byPackage].sort(([a], [b]) => a.localeCompare(b))) {
            const logic = files.filter((f) => f.role === 'logic');
            if (logic.length === 0)
                continue;
            const manifestPath = path.posix.join(pkg, 'package.json');
            const manifest = readPackageJson(ctx.repoPath, pkg);
            if (manifest === undefined && tracked.has(manifestPath))
                warnings.push(`${manifestPath}: invalid JSON, treated as absent`);
            const deps = manifest?.dependencies ?? {};
            const preset = choosePreset(ctx.methodology, GROUP, { nextjs: 'next' in deps, express: 'express' in deps && !('next' in deps) });
            const declared = findDeclaredConfig(ctx.repoPath, pkg, warnings, configCache);
            const weight = logic.reduce((sum, f) => sum + f.logicLines, 0);
            const level31 = declared === undefined ? 'none' : ciHits.length > 0 ? 'enforced' : 'declared';
            units.push({
                package: pkg,
                files,
                logic,
                weight,
                preset,
                declared,
                rules: {
                    package: pkg,
                    group: GROUP,
                    weight,
                    preset: preset.preset,
                    rulesSource: declared === undefined ? 'preset' : 'declared',
                    ...(declared === undefined ? {} : { rulesFile: declared.file }),
                    level31,
                },
            });
        }
        return { units, warnings };
    });
}
/** The installed version, read from the package's own manifest (its `exports` map hides `package.json`). */
function dcVersion() {
    for (let dir = path.dirname(fileURLToPath(import.meta.url)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
        const manifest = path.join(dir, 'node_modules', TOOL, 'package.json');
        if (!existsSync(manifest))
            continue;
        try {
            return JSON.parse(readFileSync(manifest, 'utf8')).version;
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
const configHost = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined };
async function runCruise(cruise, input, extensions, warnings) {
    const attempt = async (tsConfig) => {
        // `paths` aliases need the parsed config as the transpile options; without it the resolver reads `baseUrl` from the process cwd.
        const resolveOptions = {
            extensionAlias: { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'], '.cjs': ['.cts', '.cjs'] },
            extensions,
        };
        const parsed = tsConfig === undefined ? undefined : ts.getParsedCommandLineOfConfigFile(tsConfig, {}, configHost);
        if (tsConfig !== undefined && parsed === undefined)
            throw new Error('the config could not be parsed');
        const hasRules = input.ruleSet !== undefined && ((input.ruleSet.forbidden?.length ?? 0) > 0 || (input.ruleSet.allowed?.length ?? 0) > 0);
        const options = {
            baseDir: input.baseDir,
            validate: hasRules,
            cache: false,
            tsPreCompilationDeps: true,
            doNotFollow: { path: 'node_modules' },
            ...(hasRules ? { ruleSet: input.ruleSet } : {}),
            ...(tsConfig === undefined ? {} : { tsConfig: { fileName: tsConfig } }),
        };
        // dependency-cruiser gives tsconfig-paths-webpack-plugin `baseUrl: "./"` when the config has no baseUrl, and the plugin resolves
        // that against the process cwd, so `paths` without `baseUrl` (the Next.js default) pointed at the wrong directory and every alias
        // import was unresolved. With a baseUrl in the transpile options it passes none and the plugin uses the config's own directory.
        const transpile = parsed !== undefined && parsed.options.paths !== undefined && parsed.options.baseUrl === undefined
            ? { ...parsed, options: { ...parsed.options, baseUrl: String(parsed.options.pathsBasePath ?? path.dirname(tsConfig)) } }
            : parsed;
        const result = await cruise(input.files, options, resolveOptions, transpile === undefined ? undefined : { tsConfig: transpile });
        const output = result.output;
        return { modules: output.modules ?? [], violations: output.summary?.violations ?? [] };
    };
    if (input.tsConfig === undefined)
        return attempt(undefined);
    try {
        return await attempt(input.tsConfig);
    }
    catch (err) {
        warnings.push(`${path.relative(input.baseDir, input.tsConfig)}: could not be used by ${TOOL}, aliases are unresolved (${err instanceof Error ? err.message : String(err)})`);
        return attempt(undefined);
    }
}
function isTypeOnlyEdge(occurrences) {
    return occurrences.length > 0 && occurrences.every((o) => o.typeOnly);
}
function isRuntimeEdge(occurrences) {
    if (occurrences.length === 0)
        return true;
    return occurrences.some((o) => (o.kind === 'static' || o.kind === 'require') && o.topLevel && !o.typeOnly);
}
export const tsAdapter = {
    group: GROUP,
    async rules(ctx) {
        const { units, warnings } = await setup(ctx);
        return { units: units.map((u) => u.rules), warnings };
    },
    async graph(ctx) {
        return ctx.tools.memo(`d3:ts:graph:${ctx.repoPath}`, () => buildGraph(ctx));
    },
};
async function buildGraph(ctx) {
    const { units } = await setup(ctx);
    const warnings = [];
    let cruise;
    try {
        cruise = (await import(TOOL)).cruise;
    }
    catch (err) {
        return { unavailable: `${TOOL} could not be loaded: ${err instanceof Error ? err.message : String(err)}` };
    }
    const version = dcVersion();
    if (version !== undefined)
        ctx.tools.recordVersion(TOOL, version);
    // dependency-cruiser follows symlinks, so its resolved paths are relative to the real repo root (macOS tmpdir sits behind /var -> /private/var).
    const root = realpathSync(ctx.repoPath);
    const extensions = [...ctx.methodology.scope.source_files.extensions.typescript, ...ctx.methodology.scope.source_files.extensions.javascript];
    const scoped = new Map();
    for (const file of ctx.scope.files)
        if (file.group === GROUP)
            scoped.set(file.path, file);
    const unitByPackage = new Map(units.map((u) => [u.package, u]));
    const relative = (unit, file) => (unit.package === '.' ? file : file.slice(unit.package.length + 1));
    // Layer classification and the preset rules of preset-governed units.
    const dcRules = [];
    const meta = new Map();
    for (const unit of units) {
        if (unit.declared !== undefined)
            continue;
        const rels = unit.files.map((f) => relative(unit, f.path));
        const toFull = new Map(rels.map((rel, i) => [rel, unit.files[i].path]));
        const layerFiles = new Map();
        const add = (layer, rel) => {
            const set = layerFiles.get(layer) ?? new Set();
            set.add(toFull.get(rel));
            layerFiles.set(layer, set);
        };
        for (const [rel, layer] of globLayers(unit.preset.layers, rels))
            add(layer, rel);
        const contentLayers = Object.entries(unit.preset.layers).filter((entry) => typeof entry[1] === 'string').map(([name]) => name);
        if (contentLayers.includes('client') || contentLayers.includes('server_only')) {
            const isServerDir = globMatcher(['server/**']);
            for (const rel of rels) {
                const full = toFull.get(rel);
                const source = ctx.scope.getTsSourceFile(full);
                if (contentLayers.includes('client') && hasUseClient(source))
                    add('client', rel);
                if (contentLayers.includes('server_only')) {
                    const imports = classifyImports(source).some((o) => o.specifier === 'server-only');
                    if (imports || path.posix.basename(rel).includes('.server.') || isServerDir(rel))
                        add('server_only', rel);
                }
            }
        }
        const generated = presetRules(unit.package, unit.preset.rules, layerFiles, unit.files.map((f) => f.path));
        dcRules.push(...generated.rules);
        for (const [name, value] of generated.meta)
            meta.set(name, value);
    }
    // One graph call per distinct tsconfig; every call carries all generated preset rules.
    const groups = new Map();
    for (const unit of units) {
        const key = nearestTsConfig(root, unit.package === '.' ? '' : unit.package) ?? '';
        const list = groups.get(key) ?? [];
        list.push(...unit.files.map((f) => f.path));
        groups.set(key, list);
    }
    const allEdges = new Map();
    const violations = [];
    try {
        for (const [tsConfig, files] of groups) {
            const result = await runCruise(cruise, { baseDir: root, files, tsConfig: tsConfig === '' ? undefined : tsConfig, ruleSet: { forbidden: dcRules } }, extensions, warnings);
            for (const module of result.modules) {
                if (!scoped.has(module.source))
                    continue;
                const perTarget = allEdges.get(module.source) ?? new Map();
                for (const dependency of module.dependencies) {
                    if (dependency.resolved === module.source)
                        continue;
                    const specifiers = perTarget.get(dependency.resolved) ?? new Set();
                    specifiers.add(dependency.module);
                    perTarget.set(dependency.resolved, specifiers);
                }
                allEdges.set(module.source, perTarget);
            }
            violations.push(...result.violations);
        }
        // One extra call per distinct declared rules file; it supplies only violations.
        const declaredFiles = new Map();
        for (const unit of units) {
            if (unit.declared === undefined)
                continue;
            const entry = declaredFiles.get(unit.declared.file) ?? { config: unit.declared, governed: new Set() };
            entry.governed.add(unit.package);
            declaredFiles.set(unit.declared.file, entry);
        }
        for (const { config, governed } of declaredFiles.values()) {
            const dir = path.posix.dirname(config.file);
            const prefix = dir === '.' ? '' : `${dir}/`;
            const files = [...scoped.keys()].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
            if (files.length === 0)
                continue;
            const baseDir = dir === '.' ? root : path.join(root, dir);
            const ruleSet = {
                forbidden: config.forbidden,
                ...(config.allowed ? { allowed: config.allowed, allowedSeverity: config.allowedSeverity } : {}),
            };
            const result = await runCruise(cruise, { baseDir, files, tsConfig: nearestTsConfig(root, dir), ruleSet }, extensions, warnings);
            for (const violation of result.violations) {
                const from = path.posix.join(dir, violation.from);
                const unit = unitByPackage.get(scoped.get(from)?.package ?? '');
                if (!unit || !governed.has(unit.package))
                    continue;
                const joined = path.posix.join(dir, violation.to);
                const local = (violation.dependencyTypes ?? []).includes('local');
                if (scoped.has(joined))
                    violations.push({ ...violation, from, to: joined });
                else if (!local)
                    violations.push({ ...violation, from });
            }
        }
    }
    catch (err) {
        return { unavailable: `${TOOL} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    // Facts per unit.
    const occurrencesOf = new Map();
    const occurrences = (file) => {
        let list = occurrencesOf.get(file);
        if (!list) {
            list = classifyImports(ctx.scope.getTsSourceFile(file));
            occurrencesOf.set(file, list);
        }
        return list;
    };
    const edgeOccurrences = (from, to) => {
        const specifiers = allEdges.get(from)?.get(to);
        return specifiers ? occurrences(from).filter((o) => specifiers.has(o.specifier)) : [];
    };
    const moduleOf = new Map();
    const entryOf = new Set();
    const trackedSet = new Set(trackedPaths(ctx.repoPath));
    const entryChecks = new Map();
    for (const unit of units) {
        const roots = Array.isArray(unit.preset.modules.roots) ? unit.preset.modules.roots : [];
        const entryGlob = publicEntryGlob(unit.preset, GROUP);
        const isEntry = entryGlob === undefined ? () => false : globMatcher([entryGlob.includes('/') ? entryGlob : `**/${entryGlob}`]);
        entryChecks.set(unit.package, { roots, isEntry });
        const rels = unit.files.map((f) => relative(unit, f.path));
        const modules = moduleDirs(roots, rels);
        unit.files.forEach((file, i) => {
            const rel = rels[i];
            const dir = modules.get(rel);
            const full = dir === undefined ? undefined : unit.package === '.' ? dir : `${unit.package}/${dir}`;
            moduleOf.set(file.path, full);
            if (dir !== undefined && path.posix.dirname(rel) === dir && isEntry(rel))
                entryOf.add(file.path);
        });
    }
    const result = [];
    for (const unit of units) {
        const unitFiles = new Set(unit.files.map((f) => f.path));
        const edges = [];
        for (const file of unit.files) {
            for (const to of [...(allEdges.get(file.path)?.keys() ?? [])].sort()) {
                if (!scoped.has(to))
                    continue;
                const found = edgeOccurrences(file.path, to);
                edges.push({ from: file.path, to, fromTest: file.role === 'test', runtime: isRuntimeEdge(found) });
            }
        }
        const violating = new Set();
        const violationRules = {};
        for (const violation of violations) {
            if (violation.type !== 'dependency' || (violation.rule.severity !== 'error' && violation.rule.severity !== 'warn'))
                continue;
            if (!unitFiles.has(violation.from) || scoped.get(violation.from)?.role === 'test')
                continue;
            const info = meta.get(violation.rule.name);
            if (info?.excludesTypeOnly && isTypeOnlyEdge(edgeOccurrences(violation.from, violation.to)))
                continue;
            const key = edgeKey(violation.from, violation.to);
            violating.add(key);
            (violationRules[key] ??= []).push(info?.rule ?? violation.rule.name);
        }
        const logicFiles = unit.logic.map((f) => f.path).sort();
        const moduleDirsOfUnit = new Set(logicFiles.map((f) => moduleOf.get(f)).filter((m) => m !== undefined));
        const crossings = [];
        if (moduleDirsOfUnit.size >= 2) {
            const prefix = unit.package === '.' ? '' : `${unit.package}/`;
            const check = entryChecks.get(unit.package);
            for (const file of unit.files) {
                if (file.role === 'test')
                    continue;
                const fromModule = moduleOf.get(file.path);
                if (fromModule === undefined)
                    continue;
                for (const to of [...(allEdges.get(file.path)?.keys() ?? [])].sort()) {
                    let toModule;
                    let toEntry;
                    if (scoped.has(to)) {
                        toModule = moduleOf.get(to);
                        toEntry = entryOf.has(to);
                    }
                    else if (trackedSet.has(to) && to.startsWith(prefix) && !to.includes('node_modules/')) {
                        // A barrel is not a scoped file, but it is the canonical public entry: count the crossing.
                        const rel = to.slice(prefix.length);
                        const dir = moduleDirs(check.roots, [rel]).get(rel);
                        toModule = dir === undefined ? undefined : `${prefix}${dir}`;
                        toEntry = dir !== undefined && path.posix.dirname(rel) === dir && check.isEntry(rel);
                    }
                    else
                        continue;
                    if (toModule !== undefined && toModule !== fromModule)
                        crossings.push({ from: file.path, to, toEntry });
                }
            }
        }
        const domainFiles = logicFiles.filter(isDomainFile);
        const impure = domainFiles.filter((file) => isImpure(ctx.scope.getTsSourceFile(file), edges.filter((e) => e.from === file).map((e) => e.to), ctx.methodology.d3));
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
