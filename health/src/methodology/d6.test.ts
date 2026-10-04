import { describe, expect, it } from 'vitest';
import { RUNNER_PREFIXES } from '../scripts/expand.js';
import { loadMethodology } from './load.js';

describe('D6 lists', () => {
  const { d6 } = loadMethodology('1.0');

  it('parses script_resolution into the YAML words', () => {
    expect(d6.typecheckers).toEqual(['tsc', 'vue-tsc', 'pyright', 'basedpyright', 'mypy']);
    expect(d6.linters).toEqual(['eslint', 'biome', 'oxlint', 'ruff', 'flake8', 'pylint']);
    expect(d6.testRunners).toEqual(['vitest', 'jest', 'mocha', 'node --test', 'pytest', 'python -m unittest', 'tox', 'nox']);
    expect(d6.prefixes).toEqual(['npx', 'bunx', 'pnpm exec', 'yarn', 'uv run', 'poetry run', 'pdm run', 'python -m']);
  });

  it('every parsed prefix is handled by expand.ts, which also removes the extra runners', () => {
    const handled = RUNNER_PREFIXES.map((p) => p.join(' '));
    for (const prefix of d6.prefixes.filter((p) => p !== 'yarn')) expect(handled).toContain(prefix);
    for (const extra of ['pnpm dlx', 'yarn dlx', 'yarn exec', 'hatch run', 'pipx run', 'python3 -m']) expect(handled).toContain(extra);
  });

  it('parses the 6.5 lists', () => {
    expect(d6.envExcludedNames).toEqual(['NODE_ENV', 'CI', 'HOME', 'PATH', 'PWD', 'TZ', 'NEXT_RUNTIME']);
    expect(d6.envExcludedPrefixes).toEqual(['VERCEL_', 'NETLIFY', 'RENDER_', 'RAILWAY_', 'GITHUB_']);
    expect(d6.envExampleFiles).toEqual(['.env.example', '.env.sample', '.env.template', '.env.dist', 'example.env']);
    expect(d6.runtimePinFiles).toEqual(['.nvmrc', '.node-version', '.tool-versions', 'mise.toml', 'engines.node in package.json', 'volta in package.json', '.python-version', 'requires-python in pyproject.toml', 'runtime.txt']);
  });

  it('parses the 6.6 package manager words', () => {
    expect(d6.docPackageManagers).toEqual(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'uv', 'poetry', 'pdm', 'pip', 'pipenv', 'python', 'make', 'just']);
  });

  it('keeps the "No variables read scores 100" sentence that emptyScore relies on', () => {
    const def = loadMethodology('1.0').dimensions.find((d) => d.id === 6)?.parameters.find((p) => p.id === '6.5');
    const component = def?.scoring.method === 'mean_of_components' ? def.scoring.components.find((c) => c.key === 'env_documented') : undefined;
    expect(component?.definition).toContain('No variables read scores 100');
  });
});
