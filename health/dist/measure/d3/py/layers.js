import path from 'node:path';
import { globLayers, moduleDirs, publicEntryGlob } from '../presets.js';
import { rootOf, rootPackageDir } from './roots.js';
const stem = (file) => path.posix.basename(file, '.py');
function empty() {
    return { layers: new Map(), moduleOf: new Map(), entries: new Set(), layerModule: new Map() };
}
function entryNames(preset) {
    const entry = preset.modules.public_entry;
    const list = Array.isArray(entry) ? entry : [];
    return { file: list.includes('__init__.py'), names: list.filter((e) => e !== '__init__.py') };
}
function django(preset, files, unitDir, tracked) {
    const out = empty();
    const prefix = unitDir === '.' ? '' : `${unitDir}/`;
    const apps = [...tracked]
        .filter((p) => p.startsWith(prefix) && path.posix.basename(p) === 'apps.py')
        .map((p) => path.posix.dirname(p))
        .sort((a, b) => b.length - a.length);
    const entries = entryNames(preset);
    for (const file of files) {
        const app = apps.find((a) => (a === '.' ? true : file.startsWith(`${a}/`)));
        if (app === undefined)
            continue;
        const rel = app === '.' ? file : file.slice(app.length + 1);
        const parts = rel.split('/');
        const key = parts.length > 1 ? parts[0] : stem(rel);
        out.moduleOf.set(file, app);
        if (key === '__init__') {
            if (entries.file && parts.length === 1)
                out.entries.add(file);
            continue;
        }
        const inLayers = Object.entries(preset.layers)
            .filter((entry) => Array.isArray(entry[1]) && entry[1].includes(key))
            .map(([name]) => name);
        if (inLayers.length > 0)
            out.layers.set(file, inLayers);
        out.layerModule.set(file, `${app}/${key}`);
        if (entries.names.includes(key))
            out.entries.add(file);
    }
    return out;
}
function fastapi(preset, files, roots) {
    const out = empty();
    const layerOf = new Map();
    for (const [name, list] of Object.entries(preset.layers))
        if (Array.isArray(list))
            for (const segment of list)
                layerOf.set(segment, name);
    const inFiles = new Set(files);
    const moduleRoots = new Set();
    for (const file of files) {
        const root = rootOf(roots, file);
        if (root === undefined)
            continue;
        const base = rootPackageDir(root);
        const segments = path.posix.dirname(file) === base ? [] : path.posix.dirname(file).slice(base.length + 1).split('/');
        if (stem(file) !== '__init__')
            segments.push(stem(file));
        for (let i = segments.length - 1; i >= 0; i -= 1) {
            const layer = layerOf.get(segments[i]);
            if (layer !== undefined) {
                out.layers.set(file, [layer]);
                break;
            }
        }
        // Modules are directories below the root package: those holding router.py and the direct children of features/modules.
        const dir = path.posix.dirname(file);
        if (dir !== base && path.posix.basename(file) === 'router.py')
            moduleRoots.add(dir);
        for (let d = dir; d.length > base.length; d = path.posix.dirname(d)) {
            const parent = path.posix.dirname(d);
            if (parent.length >= base.length && ['features', 'modules'].includes(path.posix.basename(parent)))
                moduleRoots.add(d);
        }
    }
    const sorted = [...moduleRoots].sort((a, b) => b.length - a.length);
    const entries = entryNames(preset);
    for (const file of files) {
        const dir = sorted.find((m) => file.startsWith(`${m}/`));
        if (dir === undefined)
            continue;
        out.moduleOf.set(file, dir);
        if (entries.file && path.posix.dirname(file) === dir && path.posix.basename(file) === '__init__.py' && inFiles.has(file))
            out.entries.add(file);
    }
    return out;
}
function generic(preset, files, unitDir, roots) {
    const out = empty();
    const prefix = unitDir === '.' ? '' : `${unitDir}/`;
    const rels = files.map((f) => f.slice(prefix.length));
    const prefixes = ['', ...roots.map((r) => `${path.posix.relative(unitDir, rootPackageDir(r))}/`)];
    const full = new Map(rels.map((rel, i) => [rel, files[i]]));
    for (const [rel, layer] of globLayers(preset.layers, rels, prefixes))
        out.layers.set(full.get(rel), [layer]);
    const globs = Array.isArray(preset.modules.roots) ? preset.modules.roots : [];
    const dirs = moduleDirs(globs, rels, prefixes);
    const entryGlob = publicEntryGlob(preset, 'python');
    for (const rel of rels) {
        const dir = dirs.get(rel);
        if (dir === undefined)
            continue;
        const file = full.get(rel);
        out.moduleOf.set(file, `${prefix}${dir}`);
        if (entryGlob !== undefined && path.posix.dirname(rel) === dir && path.posix.basename(rel) === entryGlob)
            out.entries.add(file);
    }
    return out;
}
/** Layers, modules and public entries of a unit's in-scope Python files under the preset. `files` are repo-relative. */
export function classifyPython(preset, files, unitDir, roots, tracked) {
    if (preset.preset === 'django')
        return django(preset, files, unitDir, tracked);
    if (preset.preset === 'fastapi')
        return fastapi(preset, files, roots);
    return generic(preset, files, unitDir, roots);
}
