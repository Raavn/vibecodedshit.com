/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'This dependency is part of a circular relationship.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'This is an orphan module.',
      from: {
        orphan: true,
        pathNot: ['(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$', '[.]d[.]ts$', '(^|/)tsconfig[.]json$'],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'This module depends on a module that cannot be found.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'not-to-spec',
      severity: 'error',
      comment: 'This module depends on a spec (test) file.',
      from: {},
      to: { path: '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'This module depends on an npm package from devDependencies.',
      from: { path: '^(src)', pathNot: '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'], pathNot: ['node_modules/@types/'] },
    },
    {
      name: 'core-not-to-ui',
      severity: 'error',
      comment: 'Core code does not depend on the UI.',
      from: { path: '^src/core/' },
      to: { path: '^src/ui/' },
    },
  ],
  allowed: [
    {
      comment: 'UI may use core, local imports only.',
      from: { path: '^src/ui/' },
      to: { path: '^src/core/', dependencyTypes: ['local'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
  },
};
