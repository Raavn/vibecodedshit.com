import path from 'node:path';
import { inDir } from './lockfiles.js';
const JS_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
function pythonTool(ctx) {
    const has = (name) => ctx.tracked.has(inDir(ctx, name));
    const pyproject = ctx.read(inDir(ctx, 'pyproject.toml')) ?? '';
    if (has('pyrightconfig.json') || /^\s*\[tool\.pyright\]/m.test(pyproject))
        return 'pyright';
    const setupCfg = ctx.read(inDir(ctx, 'setup.cfg')) ?? '';
    if (has('mypy.ini') || has('.mypy.ini') || /^\s*\[tool\.mypy\]/m.test(pyproject) || /^\s*\[mypy\]/m.test(setupCfg))
        return 'mypy';
    return 'pyright';
}
/** tsc or pyright (mypy when only mypy is configured) with the repository's own config. Network off. */
export const typecheck = {
    name: 'typecheck',
    network: false,
    command(ctx) {
        if (ctx.group === 'typescript_javascript') {
            const base = ['health-capture', '/out/tsc.txt', 'health-tsc', '--noEmit', '--pretty', 'false'];
            const project = ['tsconfig.json', 'jsconfig.json'].find((name) => ctx.tracked.has(inDir(ctx, name)));
            if (project)
                return { argv: [...base, '-p', project], tool: 'tsc', report: 'tsc.txt' };
            const files = ctx.files.filter((file) => JS_FILE.test(file)).map((file) => path.posix.relative(ctx.dir, file));
            if (files.length === 0)
                return null;
            // No tsconfig or jsconfig: the methodology's default config.
            const defaults = ['--allowJs', '--checkJs', '--strict', 'false', '--target', 'esnext', '--module', 'esnext', '--moduleResolution', 'bundler', '--jsx', 'preserve', '--skipLibCheck'];
            return { argv: [...base, ...defaults, ...files], tool: 'tsc', report: 'tsc.txt' };
        }
        if (pythonTool(ctx) === 'mypy') {
            return {
                argv: ['health-capture', '/out/mypy.txt', 'health-venv', 'mypy', '--no-error-summary', '--no-pretty', '--no-color-output', '.'],
                tool: 'mypy',
                report: 'mypy.txt',
            };
        }
        return { argv: ['health-capture', '/out/pyright.json', 'health-venv', 'pyright', '--outputjson'], tool: 'pyright', report: 'pyright.json' };
    },
};
