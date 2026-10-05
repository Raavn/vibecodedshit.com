import path from 'node:path';
import { inDir, jsManager } from './lockfiles.js';
function hasBuildScript(text) {
    if (text === null)
        return false;
    try {
        const scripts = JSON.parse(text).scripts;
        return typeof scripts?.build === 'string';
    }
    catch {
        return false;
    }
}
/** First-party top-level packages: directories with an `__init__.py` that hold a logic file. */
function topLevelPackages(ctx) {
    const names = new Set();
    for (const file of ctx.files) {
        const rel = path.posix.relative(ctx.dir, file);
        const top = rel.split('/')[0];
        if (!top || top === rel || !/^[A-Za-z_]\w*$/.test(top))
            continue;
        if (ctx.tracked.has(path.posix.join(ctx.dir, top, '__init__.py')))
            names.add(top);
    }
    return [...names].sort();
}
/** The build script, or for Python `manage.py check` (Django) or importing each top-level package. Network off. */
export const build = {
    name: 'build',
    network: false,
    command(ctx) {
        if (ctx.group === 'typescript_javascript') {
            if (!hasBuildScript(ctx.read(inDir(ctx, 'package.json'))))
                return null;
            return { argv: [jsManager(ctx).manager, 'run', 'build'] };
        }
        if (/django/i.test(ctx.read(inDir(ctx, 'manage.py')) ?? '')) {
            return { argv: ['health-venv', 'python', 'manage.py', 'check'] };
        }
        const packages = topLevelPackages(ctx);
        if (packages.length === 0)
            return null;
        return { argv: ['health-venv', 'python', '-c', `import ${packages.join(', ')}`] };
    },
};
