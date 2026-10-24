import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parseIni } from '../../util/ini.js';
import { readToml } from '../../util/toml.js';
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function truthy(value) {
    if (typeof value === 'boolean')
        return value;
    return typeof value === 'string' && ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}
function pyrightLevel(mode, unsetMeans, basedpyright) {
    if (typeof mode !== 'string')
        return unsetMeans;
    switch (mode) {
        case 'off':
            return 'none';
        case 'basic':
            return 'basic';
        case 'standard':
            return 'standard';
        case 'strict':
            return 'strict';
        case 'recommended':
        case 'all':
            return basedpyright ? 'strict' : unsetMeans;
        default:
            return unsetMeans;
    }
}
function mypyLevel(section) {
    if (truthy(section.strict))
        return 'strict';
    if (truthy(section.disallow_untyped_defs) && truthy(section.check_untyped_defs))
        return 'standard';
    return 'basic';
}
function readText(file) {
    try {
        return readFileSync(file, 'utf8');
    }
    catch {
        return undefined;
    }
}
/** The level one directory declares, or undefined when it holds no pyright or mypy config. pyright wins over mypy. */
function levelInDirectory(dir, relDir, warnings) {
    const rel = (name) => (relDir === '' ? name : `${relDir}/${name}`);
    const pyproject = existsSync(path.join(dir, 'pyproject.toml')) ? readToml(path.join(dir, 'pyproject.toml')) : undefined;
    if (existsSync(path.join(dir, 'pyproject.toml')) && pyproject === undefined) {
        warnings.push(`2.2: ${rel('pyproject.toml')}: invalid TOML, ignored`);
    }
    const tool = asRecord(pyproject?.tool);
    const pyrightJson = readText(path.join(dir, 'pyrightconfig.json'));
    if (pyrightJson !== undefined) {
        const parsed = ts.parseConfigFileTextToJson('pyrightconfig.json', pyrightJson);
        if (parsed.error)
            warnings.push(`2.2: ${rel('pyrightconfig.json')}: invalid JSON, ignored`);
        else
            return pyrightLevel(asRecord(parsed.config)?.typeCheckingMode, 'standard', false);
    }
    const pyright = asRecord(tool?.pyright);
    if (pyright)
        return pyrightLevel(pyright.typeCheckingMode, 'standard', false);
    const basedpyright = asRecord(tool?.basedpyright);
    if (basedpyright)
        return pyrightLevel(basedpyright.typeCheckingMode, 'strict', true);
    for (const name of ['mypy.ini', '.mypy.ini']) {
        const text = readText(path.join(dir, name));
        const section = text === undefined ? undefined : parseIni(text).mypy;
        if (section)
            return mypyLevel(section);
    }
    const mypyToml = asRecord(tool?.mypy);
    if (mypyToml)
        return mypyLevel(mypyToml);
    const setupCfg = readText(path.join(dir, 'setup.cfg'));
    const cfgSection = setupCfg === undefined ? undefined : parseIni(setupCfg).mypy;
    if (cfgSection)
        return mypyLevel(cfgSection);
    return undefined;
}
/** Search from the unit's package directory up to the repository root; the first directory with a config decides. */
export function pythonLevel(repoPath, packageDir, warnings) {
    const parts = packageDir === '.' ? [] : packageDir.split('/');
    for (let depth = parts.length; depth >= 0; depth -= 1) {
        const relDir = parts.slice(0, depth).join('/');
        const level = levelInDirectory(path.join(repoPath, relDir), relDir, warnings);
        if (level !== undefined)
            return level;
    }
    return 'none';
}
