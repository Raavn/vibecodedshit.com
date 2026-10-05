import path from 'node:path';
const ESLINT_CONFIG = '/opt/health/eslint.config.mjs';
const RUFF_CONFIG = '/opt/health/ruff.toml';
/** The methodology's pinned ESLint and ruff rulesets, baked into the image. The repository's own lint config is never used. Network off. */
export const lint = {
    name: 'lint',
    network: false,
    command(ctx) {
        const files = ctx.files.map((file) => path.posix.relative(ctx.dir, file));
        if (files.length === 0)
            return null;
        if (ctx.group === 'typescript_javascript') {
            return {
                argv: ['health-capture', '/out/eslint.json', 'eslint', '-c', ESLINT_CONFIG, '-f', 'json', '--no-error-on-unmatched-pattern', ...files],
                tool: 'eslint',
                report: 'eslint.json',
            };
        }
        return {
            argv: ['health-capture', '/out/ruff.json', 'ruff', 'check', '--config', RUFF_CONFIG, '--no-cache', '--output-format', 'json', ...files],
            tool: 'ruff',
            report: 'ruff.json',
        };
    },
};
