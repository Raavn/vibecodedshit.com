import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { dimensionFileSchema, methodologyFileSchema, presetFileSchema, scopeFileSchema, } from './schema.js';
export class MethodologyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MethodologyError';
    }
}
/** Package root: the directory holding `methodology/`, both from `src/` and from `dist/`. */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function readYaml(file, schema) {
    let doc;
    try {
        doc = parse(readFileSync(file, 'utf8'));
    }
    catch (err) {
        throw new MethodologyError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const result = schema.safeParse(doc);
    if (!result.success) {
        const issue = result.error.issues[0];
        const where = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)';
        throw new MethodologyError(`${file}: ${where}: ${issue?.message ?? 'invalid'}`);
    }
    return result.data;
}
function commaList(text) {
    return text
        .split(',')
        .map((entry) => entry.trim().replace(/^node:/, ''))
        .filter((entry) => entry !== '');
}
function parseD3Lists(def, file = 'dimension 3') {
    const lists = { forbiddenImports: { typescript_javascript: [], python: [] }, infrastructureDirectories: [] };
    if (!def)
        return lists;
    const measure = def.measure ?? {};
    for (const group of ['typescript_javascript', 'python']) {
        const match = /Forbidden imports:\s*(.+?)\.(?:\s|$)/s.exec(measure[group] ?? '');
        if (!match?.[1])
            throw new MethodologyError(`${file}: parameter ${def.id} measure.${group} has no "Forbidden imports:" list`);
        lists.forbiddenImports[group] = [...new Set(commaList(match[1]))];
    }
    const infra = (measure.infrastructure_directories ?? '').replace(/\.\s*$/, '');
    lists.infrastructureDirectories = commaList(infra);
    if (lists.infrastructureDirectories.length === 0) {
        throw new MethodologyError(`${file}: parameter ${def.id} measure.infrastructure_directories is empty`);
    }
    return lists;
}
function words(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/,?\s+(?:and|or)\s+/g, ', ')
        .split(/[,;]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
}
function parseD6Lists(scriptResolution, defs, defs6x, file = 'dimension 6') {
    const text = (scriptResolution ?? '').replace(/\s+/g, ' ');
    const pick = (re, what) => {
        const match = re.exec(text);
        if (!match?.[1])
            throw new MethodologyError(`${file}: script_resolution has no ${what} list`);
        return words(match[1]);
    };
    const typecheckers = pick(/typecheckers (.+?);/, 'typecheckers');
    const linters = pick(/linters (.+?);/, 'linters');
    const testRunners = pick(/test runners (.+?)\. The prefixes/, 'test runners');
    const prefixes = pick(/The prefixes (.+?) are removed/, 'prefixes');
    const env = defs?.scoring.method === 'mean_of_components' ? defs.scoring.components.find((c) => c.key === 'env_documented') : undefined;
    const runtime = defs?.scoring.method === 'mean_of_components' ? defs.scoring.components.find((c) => c.key === 'runtime_pinned') : undefined;
    const envMeasure = (env?.measure ?? '').replace(/\s+/g, ' ');
    const examples = /Example files: (.+?)\. Reads:/.exec(envMeasure)?.[1];
    const excluded = /Excluded names: (.+?), and names starting with (.+?)\.?$/.exec(envMeasure);
    if (!examples || !excluded?.[1] || !excluded[2])
        throw new MethodologyError(`${file}: parameter 6.5 env_documented measure has no example files or excluded names`);
    const pins = /^Any of (.+?)\.?$/.exec((runtime?.measure ?? '').replace(/\s+/g, ' '))?.[1];
    if (!pins)
        throw new MethodologyError(`${file}: parameter 6.5 runtime_pinned measure has no file list`);
    const docMeasure = (defs6x?.measure?.all_languages ?? '').replace(/\s+/g, ' ');
    const managers = /starts with a package manager \((.+?)\)/.exec(docMeasure)?.[1];
    if (!managers)
        throw new MethodologyError(`${file}: parameter 6.6 measure has no package manager list`);
    return {
        typecheckers,
        linters,
        testRunners,
        prefixes,
        envExcludedNames: words(excluded[1]),
        envExcludedPrefixes: words(excluded[2]),
        envExampleFiles: words(examples),
        runtimePinFiles: words(pins),
        docPackageManagers: words(managers),
    };
}
export function loadMethodology(version, rootDir = packageRoot) {
    if (!/^\d+\.\d+$/.test(version)) {
        throw new MethodologyError(`Unknown methodology version "${version}"`);
    }
    const dir = path.join(rootDir, 'methodology', `v${version}`);
    if (!existsSync(dir)) {
        throw new MethodologyError(`Unknown methodology version "${version}" (no ${dir})`);
    }
    const main = readYaml(path.join(dir, 'methodology.yaml'), methodologyFileSchema);
    if (main.version !== version) {
        throw new MethodologyError(`${path.join(dir, 'methodology.yaml')}: version "${main.version}" does not match directory v${version}`);
    }
    const scope = readYaml(path.join(dir, 'scope.yaml'), scopeFileSchema);
    const presets = {};
    const dimensions = main.dimensions.map((entry) => {
        const file = path.join(dir, entry.file);
        const parsed = readYaml(file, dimensionFileSchema);
        if (parsed.dimension.id !== entry.id || parsed.dimension.key !== entry.key) {
            throw new MethodologyError(`${file}: dimension id/key do not match methodology.yaml`);
        }
        const total = parsed.parameters.reduce((sum, p) => sum + p.weight, 0);
        if (Math.abs(total - 100) > 1e-9) {
            throw new MethodologyError(`${file}: parameter weights sum to ${total}, expected 100`);
        }
        for (const presetFile of parsed.presets?.files ?? []) {
            const loaded = readYaml(path.join(dir, presetFile), presetFileSchema);
            presets[loaded.preset.key] = {
                preset: loaded.preset.key,
                name: loaded.preset.name,
                ...(loaded.conventions === undefined ? {} : { conventions: loaded.conventions }),
                languages: loaded.preset.languages,
                layers: loaded.layers,
                modules: loaded.modules,
                rules: loaded.rules,
            };
        }
        return {
            id: parsed.dimension.id,
            key: parsed.dimension.key,
            name: parsed.dimension.name,
            ...(parsed.script_resolution === undefined ? {} : { scriptResolution: parsed.script_resolution }),
            parameters: parsed.parameters,
        };
    });
    const d3Def = dimensions.find((d) => d.id === 3)?.parameters.find((p) => p.id === '3.5');
    const d6Dim = dimensions.find((d) => d.id === 6);
    return {
        version,
        presets,
        d3: parseD3Lists(d3Def, path.join(dir, 'dimensions')),
        d6: parseD6Lists(d6Dim?.scriptResolution, d6Dim?.parameters.find((p) => p.id === '6.5'), d6Dim?.parameters.find((p) => p.id === '6.6'), path.join(dir, 'dimensions')),
        dimensions,
        capMargin: main.aggregation.dimension_to_health.cap_margin,
        bands: main.bands,
        scope,
        execution: main.execution,
    };
}
