import { describe, expect, it } from 'vitest';
import { materializeFixture } from '../../test/helpers/fixture.js';
import { loadMethodology } from '../methodology/load.js';
import { EntryPointChecks } from '../measure/ops/entry-points.js';
import { checkKinds, type CheckKind } from './checks.js';
import { expandCommand } from './expand.js';

const { d6 } = loadMethodology('1.0');
const repo = (files: Record<string, string>): string => materializeFixture('blank', {}, files);
const pkg = (scripts: Record<string, string>): string => JSON.stringify({ name: 'x', scripts });

/** The checks a command text runs, from the root. */
function kindsOf(dir: string, text: string, from = '.'): CheckKind[] {
  const kinds = new Set<CheckKind>();
  for (const cmd of expandCommand(dir, text, { dir: from, file: 'ci.yml' })) for (const k of checkKinds(cmd, d6)) kinds.add(k);
  return [...kinds].sort();
}

const level = (dir: string, pkgDir = '.'): number => Math.max(0, ...new EntryPointChecks(dir, d6).forUnit(pkgDir).map((e) => e.kinds.size));

describe('r-nested', () => {
  const files = {
    'package.json': pkg({ verify: 'npm run check', check: 'npm run lint && npm run types && npm run unit', lint: 'eslint .', types: 'tsc --noEmit', unit: 'vitest run', pretest: 'tsc --noEmit', test: 'jest', posttest: 'eslint .', missing: 'npm run nope', a: 'npm run b', b: 'npm run a' }),
    'second/package.json': pkg({ all: 'npm run a', a: 'npm run b', b: 'npm run c', c: 'npm run d', d: 'eslint .' }),
  };

  it('verify reaches typecheck, lint and test through 3 bodies (level 3)', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'npm run verify')).toEqual(['lint', 'test', 'typecheck']);
    expect(level(dir)).toBe(3);
  });

  it('stops at body 3: `all` runs no check, `d` on its own is level 1', () => {
    const dir = repo(files);
    const commands = expandCommand(dir, 'npm run all', { dir: 'second', file: 'ci.yml' });
    expect(commands.map((c) => [c.tool, c.argv.join(' '), c.depth])).toEqual([['npm', 'run c', 3]]);
    expect(kindsOf(dir, 'npm run all', 'second')).toEqual([]);
    expect(kindsOf(dir, 'npm run d', 'second')).toEqual(['lint']);
    expect(level(dir, 'second')).toBe(3); // the root verify covers the package too
  });

  it('reads pretest and posttest for npm test, keeps a call to a missing script plain, and stops on a cycle', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'npm test')).toEqual(['lint', 'test', 'typecheck']);
    expect(expandCommand(dir, 'npm run nope', { dir: '.', file: 'x' }).map((c) => c.tool)).toEqual(['npm']);
    expect(expandCommand(dir, 'npm run a', { dir: '.', file: 'x' }).map((c) => [c.tool, c.argv.join(' ')])).toEqual([['npm', 'run a']]);
  });

  it('a package with only its own scripts and no root entry point is scored on its own', () => {
    const dir = repo({ 'second/package.json': files['second/package.json'] });
    expect(level(dir, 'second')).toBe(1);
  });
});

describe('r-makefile', () => {
  const files = {
    'package.json': pkg({ types: 'tsc --noEmit', lint: 'eslint .', test: 'vitest run' }),
    Makefile: '.PHONY: verify\nVAR = 1\n%.o: %.c\n\tcc\nverify: typecheck lint test\ntypecheck:\n\tnpm run types\nlint:\n\t@npm run lint\ntest:\n\tnpm test\nnested: unit\nunit:\n\t$(MAKE) test\n',
    'sub/Makefile': 'check:\n\teslint .\n',
  };

  it('a Makefile target calling a package script reaches all three checks (level 3)', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'make verify')).toEqual(['lint', 'test', 'typecheck']);
    expect(level(dir)).toBe(3);
  });

  it('a prerequisite and $(MAKE) <target> are calls, each one body deeper', () => {
    const dir = repo({ Makefile: 'nested: unit\nunit:\n\t$(MAKE) direct\ndirect:\n\ttsc --noEmit\n' });
    const commands = expandCommand(dir, 'make nested', { dir: '.', file: 'x' });
    expect(commands.map((c) => [c.tool, c.depth, c.chain])).toEqual([['tsc', 3, ['Makefile:nested', 'Makefile:unit', 'Makefile:direct']]]);
  });

  it('make -C changes the directory', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'make -C sub check')).toEqual(['lint']);
  });
});

describe('r-prefixes', () => {
  const dir = repo({ 'package.json': pkg({}) });
  const cases: [string, CheckKind[]][] = [
    ['npx tsc --noEmit', ['typecheck']],
    ['bunx eslint .', ['lint']],
    ['pnpm exec vitest run', ['test']],
    ['yarn jest', ['test']],
    ['yarn eslint .', ['lint']],
    ['pnpm vitest', ['test']],
    ['uv run mypy .', ['typecheck']],
    ['poetry run ruff check .', ['lint']],
    ['pdm run pytest', ['test']],
    ['python -m unittest', ['test']],
    ['pnpm dlx vitest', ['test']],
    ['yarn dlx eslint .', ['lint']],
    ['hatch run pytest', ['test']],
    ['pipx run flake8', ['lint']],
    ['python3 -m pytest', ['test']],
    ['sudo env FOO=1 npx vitest', ['test']],
    ['node --test', ['test']],
    ['ruff format .', []],
    ['biome format .', []],
    ['biome check .', ['lint']],
    ['ruff check .', ['lint']],
    ['tsc --init', []],
    ['eslint --version', []],
    ['tsc -b', ['typecheck']],
    ['node server.js', []],
  ];
  it.each(cases)('%s', (text, expected) => {
    expect(kindsOf(dir, text)).toEqual(expected);
  });

  it('yarn <script> calls the script when package.json defines it', () => {
    const withScript = repo({ 'package.json': pkg({ eslint: 'echo no' }) });
    expect(kindsOf(withScript, 'yarn eslint .')).toEqual([]);
  });

  it('turbo, nx, lerna, next, ng and react-scripts are not recognised', () => {
    for (const text of ['turbo run lint', 'nx run-many -t test', 'lerna run test', 'next lint', 'ng lint', 'react-scripts test']) expect(kindsOf(dir, text)).toEqual([]);
  });
});

describe('r-just', () => {
  it('reads a recipe with dependencies, shebang bodies and ignores set, alias and assignments', () => {
    const dir = repo({
      justfile: 'set shell := ["bash", "-c"]\nalias v := verify\nname := "x"\n\nverify: lint types\n    npm test\n\nlint:\n    @eslint .\n\ntypes:\n    -tsc --noEmit\n\nscripted:\n    #!/usr/bin/env bash\n    set -e\n    vitest run\n',
      'package.json': pkg({ test: 'vitest run' }),
    });
    expect(kindsOf(dir, 'just verify')).toEqual(['lint', 'test', 'typecheck']);
    expect(kindsOf(dir, 'just')).toEqual(['lint', 'test', 'typecheck']);
    expect(kindsOf(dir, 'just scripted')).toEqual(['test']);
    expect(level(dir)).toBe(3);
  });
});

describe('r-tox', () => {
  const files = {
    'tox.ini': '[tox]\nenvlist = py{311,312}-lint, type\n\n[testenv]\ncommands =\n    pytest\n\n[testenv:lint]\ncommands =\n    {envpython} -m flake8 {posargs}\n    py311: eslint .\n    py312: ruff check .\n\n[testenv:type]\ncommands =\n    mypy {toxinidir}\n',
  };

  it('expands brace sets, looks up envs by factor and substitutes {envpython}', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'tox -e py311-lint')).toEqual(['lint']);
    expect(expandCommand(dir, 'tox -e py311-lint', { dir: '.', file: 'x' }).map((c) => [c.tool, c.argv.join(' ')])).toEqual([['flake8', ''], ['eslint', '.']]);
    expect(expandCommand(dir, 'tox -e py312-lint', { dir: '.', file: 'x' }).map((c) => c.tool)).toEqual(['flake8', 'ruff']);
    expect(kindsOf(dir, 'tox -e type')).toEqual(['typecheck']);
  });

  it('tox with no -e runs the envlist; the tool itself is a test check only when no tox file can be read', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'tox')).toEqual(['lint', 'typecheck']);
    expect(kindsOf(repo({ 'package.json': pkg({}) }), 'tox')).toEqual(['test']);
    expect(kindsOf(dir, 'tox -e nope')).toEqual([]);
  });

  it('reads tox.toml and [tool.tox] in pyproject', () => {
    const toml = repo({ 'tox.toml': 'env_list = ["lint"]\n[env_run_base]\ncommands = [["pytest"]]\n[env.lint]\ncommands = [["ruff", "check", "."]]\n' });
    expect(kindsOf(toml, 'tox -e lint')).toEqual(['lint']);
    const pyproject = repo({ 'pyproject.toml': '[tool.tox]\nlegacy_tox_ini = """\n[tox]\nenvlist = type\n[testenv:type]\ncommands = mypy .\n"""\n' });
    expect(kindsOf(pyproject, 'tox')).toEqual(['typecheck']);
  });
});

describe('r-nox', () => {
  const files = {
    'noxfile.py': 'import nox\n\n@nox.session(name="tests")\ndef run_tests(session):\n    session.install("pytest")\n    session.run("pytest", "-q")\n    session.notify("lint")\n\n@nox.session\ndef lint(session):\n    session.run("ruff", "check", ".")\n    session.run("echo", some_var)\n\n@nox.session\ndef typecheck(s):\n    s.run("mypy", ".")\n',
  };

  it('names sessions from name= or the function, follows notify, joins literal arguments and marks a non-literal one', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'nox -s tests')).toEqual(['lint', 'test']);
    expect(expandCommand(dir, 'nox -s lint', { dir: '.', file: 'x' }).map((c) => [c.tool, c.argv.join(' ')])).toEqual([['ruff', 'check .'], ['echo', '?']]);
    expect(kindsOf(dir, 'nox -s typecheck')).toEqual(['typecheck']);
    expect(kindsOf(dir, 'nox')).toEqual(['lint', 'test', 'typecheck']);
  });

  it('nox is a test check only when no noxfile can be read', () => {
    expect(kindsOf(repo({ 'package.json': pkg({}) }), 'nox -s tests')).toEqual(['test']);
    expect(kindsOf(repo(files), 'nox -s nope')).toEqual([]);
  });
});

describe('r-pyproject', () => {
  const files = {
    'pyproject.toml': [
      '[project.scripts]', 'tool = "pkg.cli:main"',
      '[tool.pdm.scripts]', 'check = { composite = ["lint", "types"] }', 'lint = { cmd = ["ruff", "check", "."] }', 'types = "mypy ."', 'unit = { shell = "pytest -q" }',
      '[tool.hatch.envs.default.scripts]', 'lint = "ruff check ."', 'all = ["lint", "pytest"]',
      '[tool.poe.tasks]', 'lint = "flake8"', 'ci = { sequence = ["lint", { cmd = "mypy ." }, "pytest"] }',
    ].join('\n'),
  };

  it('pdm composite and cmd arrays, hatch scripts naming another, poe sequences', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'pdm run check')).toEqual(['lint', 'typecheck']);
    expect(kindsOf(dir, 'pdm run unit')).toEqual(['test']);
    expect(kindsOf(dir, 'hatch run all')).toEqual(['lint', 'test']);
    expect(kindsOf(dir, 'poe ci')).toEqual(['lint', 'test', 'typecheck']);
  });

  it('[project.scripts] exists and runs no recognised tool; uv run falls back to prefix removal', () => {
    const dir = repo(files);
    expect(kindsOf(dir, 'uv run tool')).toEqual([]);
    expect(kindsOf(dir, 'uv run pytest')).toEqual(['test']);
    expect(kindsOf(dir, 'poetry run mypy .')).toEqual(['typecheck']);
  });

  it('lists every kind of entry point in one directory', () => {
    const dir = repo({ ...files, 'package.json': pkg({ a: 'tsc' }), Makefile: 'm:\n\ttsc\n', justfile: 'j:\n    tsc\n', 'tox.ini': '[tox]\nenvlist = e\n', 'noxfile.py': 'import nox\n@nox.session\ndef n(session): pass\n' });
    const names = new EntryPointChecks(dir, d6).inDir('.').map((e) => e.name);
    for (const expected of ['package-json:a', 'makefile:m', 'justfile:j', 'tox:e', 'nox:n', 'pyproject:pdm:check', 'pyproject:hatch:default:lint', 'pyproject:poe:ci', 'pyproject:scripts:tool']) {
      expect(names).toContain(expected);
    }
  });
});
