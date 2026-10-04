import type { Step } from '../types.js';
import { inDir, jsManager, requirementsFiles } from './lockfiles.js';

const JS_INSTALL = {
  npm: { locked: ['npm', 'ci'], unlocked: ['npm', 'install'] },
  pnpm: { locked: ['pnpm', 'install', '--frozen-lockfile'], unlocked: ['pnpm', 'install'] },
  yarn: { locked: ['yarn', 'install', '--immutable'], unlocked: ['yarn', 'install'] },
  bun: { locked: ['bun', 'install', '--frozen-lockfile'], unlocked: ['bun', 'install'] },
} as const;

/** pip installs into `.venv`, so later steps find the packages the same way as with uv, poetry, pdm and pipenv. */
function pip(args: string[]): string[] {
  return ['sh', '-c', 'python -m venv .venv && exec .venv/bin/pip install "$@"', 'sh', ...args];
}

/** Dependencies from the lockfile, or from the manifest when there is none. The only step with the network on. */
export const install: Step = {
  name: 'install',
  network: true,
  command(ctx) {
    if (ctx.group === 'typescript_javascript') {
      if (!ctx.tracked.has(inDir(ctx, 'package.json'))) return null;
      const { manager, locked } = jsManager(ctx);
      return { argv: [...JS_INSTALL[manager][locked ? 'locked' : 'unlocked']] };
    }
    const has = (name: string): boolean => ctx.tracked.has(inDir(ctx, name));
    if (has('uv.lock')) return { argv: ['uv', 'sync', '--frozen'] };
    if (has('poetry.lock')) return { argv: ['poetry', 'install', '--sync'] };
    if (has('pdm.lock')) return { argv: ['pdm', 'sync'] };
    if (has('Pipfile.lock')) return { argv: ['pipenv', 'sync'] };
    const requirements = requirementsFiles(ctx);
    if (requirements.length > 0) return { argv: pip(requirements.flatMap((file) => ['-r', file])) };
    if (has('Pipfile')) return { argv: ['pipenv', 'install'] };
    if (has('pyproject.toml') || has('setup.py')) return { argv: pip(['.']) };
    return null;
  },
};
