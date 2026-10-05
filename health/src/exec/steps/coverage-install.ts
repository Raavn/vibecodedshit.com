import type { Step } from '../types.js';

/**
 * `@vitest/coverage-v8` has to match the installed vitest, so it cannot be baked into the image. This
 * installs it into the temporary copy only (never into package.json or a lockfile). The only network-on
 * step after install. A failure is a tool error: the provider is the tool's dependency, not the repository's.
 */
export const coverageInstall: Step = {
  name: 'coverage-install',
  network: true,
  command(ctx) {
    return ctx.invocation?.runner === 'vitest' ? { argv: ['health-coverage-install'] } : null;
  },
};
