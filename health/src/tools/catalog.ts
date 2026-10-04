import type { ToolName } from './kit.js';

export type CatalogEntry =
  | { kind: 'npm'; pkg: string; install: string }
  | { kind: 'path'; bin: string; versionArgs: string[]; versionPattern: RegExp; install: string };

export const catalog: Record<ToolName, CatalogEntry> = {
  jscpd: { kind: 'npm', pkg: 'jscpd', install: 'npm install (jscpd is a dependency of health)' },
  knip: { kind: 'npm', pkg: 'knip', install: 'npm install (knip is a dependency of health)' },
  complexipy: {
    kind: 'path',
    bin: 'complexipy',
    versionArgs: ['--version'],
    versionPattern: /(\d+\.\d+\.\d+\S*)/,
    install: 'pipx install complexipy (or uv tool install complexipy)',
  },
  vulture: {
    kind: 'path',
    bin: 'vulture',
    versionArgs: ['--version'],
    versionPattern: /(\d+\.\d+\S*)/,
    install: 'pipx install vulture (or uv tool install vulture)',
  },
  deptry: {
    kind: 'path',
    bin: 'deptry',
    versionArgs: ['--version'],
    versionPattern: /(\d+\.\d+\.\d+\S*)/,
    install: 'pipx install deptry (or uv tool install deptry)',
  },
  'osv-scanner': {
    kind: 'path',
    bin: 'osv-scanner',
    versionArgs: ['--version'],
    versionPattern: /(\d+\.\d+\.\d+\S*)/,
    install: 'brew install osv-scanner, or https://github.com/google/osv-scanner/releases',
  },
  gitleaks: {
    kind: 'path',
    bin: 'gitleaks',
    versionArgs: ['version'],
    versionPattern: /(\d+\.\d+\.\d+\S*)/,
    install: 'brew install gitleaks, or https://github.com/gitleaks/gitleaks/releases',
  },
  'import-linter': {
    kind: 'path',
    bin: 'lint-imports',
    versionArgs: ['--version'],
    versionPattern: /import-linter (\d+(?:\.\d+)+)/,
    install: 'pipx install import-linter (or uv tool install import-linter)',
  },
};
