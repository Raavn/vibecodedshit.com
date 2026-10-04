import { describe, expect, it } from 'vitest';
import { materializeFixture } from '../../test/helpers/fixture.js';
import { resetTrackedCache } from '../scope/tracked.js';
import { normalizeName, pythonDeclaredDeps } from './python.js';

function deps(tracked: Record<string, string>, dir = '.'): string[] {
  resetTrackedCache();
  const repo = materializeFixture('d3-na-py', {}, tracked);
  return [...pythonDeclaredDeps(repo, dir)].sort();
}

describe('pythonDeclaredDeps', () => {
  it('normalises names per PEP 503', () => {
    expect(normalizeName('Django_Rest.Framework')).toBe('django-rest-framework');
  });

  it('reads [project], optional dependencies and dependency groups', () => {
    expect(
      deps({
        'pyproject.toml':
          '[project]\nname = "x"\ndependencies = ["Django[argon2]>=4 ; python_version > \'3.9\'", "requests"]\n[project.optional-dependencies]\ndev = ["pytest>=8"]\n[dependency-groups]\nlint = ["ruff"]\n',
      }),
    ).toEqual(['django', 'pytest', 'requests', 'ruff']);
  });

  it('reads poetry tables without the python entry', () => {
    expect(
      deps({ 'pyproject.toml': '[tool.poetry.dependencies]\npython = "^3.11"\nFastAPI = "*"\n[tool.poetry.group.dev.dependencies]\nblack = "*"\n' }),
    ).toEqual(['black', 'fastapi']);
  });

  it('reads requirements files with one level of -r includes, Pipfile and setup.cfg', () => {
    expect(
      deps({
        'requirements.txt': '# pins\n-r base.txt\n--index-url https://x\nflask==3.0  # web\n',
        'base.txt': 'httpx\n',
        'requirements-dev.txt': 'pytest\n',
        Pipfile: '[packages]\nstarlette = "*"\n[dev-packages]\nmypy = "*"\n',
        'setup.cfg': '[options]\ninstall_requires =\n    sqlalchemy>=2\n    boto3\n',
      }),
    ).toEqual(['boto3', 'flask', 'httpx', 'mypy', 'pytest', 'sqlalchemy', 'starlette']);
  });

  it('reads the package directory only, never an ancestor', () => {
    expect(
      deps({ 'pyproject.toml': '[project]\nname = "x"\ndependencies = ["django"]\n', 'svc/pyproject.toml': '[project]\nname = "s"\ndependencies = ["fastapi"]\n' }, 'svc'),
    ).toEqual(['fastapi']);
  });

  it('an unparseable pyproject.toml gives nothing', () => {
    expect(deps({ 'pyproject.toml': 'dependencies = [' })).toEqual([]);
  });
});
