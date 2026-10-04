import { describe, expect, it } from 'vitest';
import { materializeFixture } from '../../test/helpers/fixture.js';
import { resetTrackedCache } from '../scope/tracked.js';
import { ciCommands } from './ci.js';
import { parseMakefile } from './entry-points/makefile.js';
import { ciInvokes, expandCommand } from './expand.js';

function repo(files: Record<string, string>): string {
  resetTrackedCache();
  return materializeFixture('d3-na-ts', {}, files);
}

const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: 'x', scripts });
const ci = (run: string) => `jobs:\n  t:\n    steps:\n      - run: ${run}\n`;

describe('parseMakefile', () => {
  it('reads targets, prerequisites and recipe lines without the @ - + prefixes, with continuations', () => {
    const targets = parseMakefile('.PHONY: a\na b: c d\n\t@echo hi\n\t-npm run x \\\n\t  --flag\n\n%.o: %.c\n\tcc\nVAR = 1\n');
    expect(targets.get('a')).toEqual({ prerequisites: ['c', 'd'], recipe: ['echo hi', 'npm run x --flag'] });
    expect(targets.get('b')).toEqual(targets.get('a'));
    expect([...targets.keys()]).toEqual(['a', 'b']);
  });
});

describe('ciCommands', () => {
  it('reads the five CI formats', () => {
    const dir = repo({
      '.github/workflows/a.yml': 'jobs:\n  j:\n    defaults:\n      run:\n        working-directory: app\n    steps:\n      - run: gh1\n      - run: gh2\n        working-directory: other\n      - uses: x\n',
      '.gitlab-ci.yml': 'stages: [t]\ntest:\n  before_script: [gl0]\n  script:\n    - gl1\n    - [gl2]\n',
      '.circleci/config.yml': 'jobs:\n  b:\n    steps:\n      - checkout\n      - run: cc1\n      - run:\n          command: cc2\n',
      'bitbucket-pipelines.yml': 'pipelines:\n  default:\n    - step:\n        script:\n          - bb1\n',
      'azure-pipelines.yml': 'steps:\n  - script: az1\n  - bash: az2\n  - pwsh: az3\n',
    });
    const got = ciCommands(dir).map((c) => [c.format, c.command, c.dir]);
    expect(got).toEqual(expect.arrayContaining([
      ['github', 'gh1', 'app'], ['github', 'gh2', 'other'], ['gitlab', 'gl0', '.'], ['gitlab', 'gl1', '.'], ['gitlab', 'gl2', '.'],
      ['circleci', 'cc1', '.'], ['circleci', 'cc2', '.'], ['bitbucket', 'bb1', '.'], ['azure', 'az1', '.'], ['azure', 'az2', '.'], ['azure', 'az3', '.'],
    ]));
    expect(got).toHaveLength(11);
  });

  it('takes a leading cd as the working directory and skips invalid YAML with a warning', () => {
    const dir = repo({ '.github/workflows/a.yml': ci('cd web && npm test'), '.gitlab-ci.yml': 'a: [\n' });
    const warnings: string[] = [];
    expect(ciCommands(dir, warnings).map((c) => [c.file, c.dir])).toEqual([['.github/workflows/a.yml', 'web']]);
    expect(warnings[0]).toContain('.gitlab-ci.yml: invalid YAML');
  });
});

describe('expandCommand', () => {
  const at = (dir: string, text: string, maxDepth?: number) => expandCommand(dir, text, { dir: '.', file: 'ci.yml' }, { maxDepth }).map((c) => [c.tool, c.depth, c.chain]);

  it('splits on separators outside quotes and strips wrappers and runner prefixes', () => {
    const dir = repo({});
    expect(at(dir, 'FOO=1 sudo npx --no-install depcruise src && echo "a && b" ; uv run lint-imports | cat').map((c) => c[0])).toEqual(['depcruise', 'echo', 'lint-imports', 'cat']);
    expect(at(dir, 'python3 -m pytest').map((c) => c[0])).toEqual(['pytest']);
    expect(at(dir, 'pnpm exec depcruise src').map((c) => c[0])).toEqual(['depcruise']);
  });

  it('follows npm scripts, make targets and prerequisites, and pre/post scripts for npm', () => {
    const dir = repo({
      'package.json': pkg({ verify: 'npm run arch', prearch: 'echo pre', arch: 'depcruise src', postarch: 'echo post', test: 'vitest' }),
      Makefile: 'check: lint\n\tnpm run verify\nlint:\n\teslint .\n',
    });
    expect(at(dir, 'make check').map((c) => c[0])).toEqual(['eslint', 'echo', 'depcruise', 'echo']);
    expect(at(dir, 'npm test').map((c) => c[0])).toEqual(['vitest']);
    expect(at(dir, 'yarn verify').map((c) => c[0])).toEqual(['echo', 'depcruise', 'echo']);
    expect(at(dir, '$(MAKE) lint').map((c) => c[0])).toEqual(['eslint']);
  });

  it('counts bodies read: at most three, then the call stays a plain command', () => {
    const dir = repo({
      'package.json': pkg({ a: 'npm run b', b: 'npm run c', c: 'npm run d', d: 'depcruise src' }),
    });
    expect(at(dir, 'npm run a')).toEqual([['npm', 3, ['package.json:a', 'package.json:b', 'package.json:c']]]);
    expect(at(dir, 'npm run a', 4).map((c) => c[0])).toEqual(['depcruise']);
  });

  it('keeps a missing target and a cycle as a plain runner command', () => {
    const dir = repo({ 'package.json': pkg({ a: 'npm run b', b: 'npm run a' }) });
    expect(at(dir, 'npm run nope').map((c) => c[0])).toEqual(['npm']);
    expect(at(dir, 'npm run a').map((c) => c[0])).toEqual(['npm']);
    expect(at(dir, 'make nothing').map((c) => c[0])).toEqual(['make']);
  });

  it('changes directory for cd, npm --prefix and make -C', () => {
    const dir = repo({
      'web/package.json': pkg({ arch: 'depcruise src' }),
      'tools/Makefile': 'check:\n\tdepcruise .\n',
    });
    expect(at(dir, 'cd web && npm run arch').map((c) => c[0])).toEqual(['depcruise']);
    expect(at(dir, 'npm --prefix web run arch').map((c) => c[0])).toEqual(['depcruise']);
    expect(at(dir, 'make -C tools check').map((c) => c[0])).toEqual(['depcruise']);
  });
});

describe('ciInvokes', () => {
  it('finds a CI command that reaches the tool within three levels', () => {
    const dir = repo({
      '.github/workflows/ci.yml': ci('make check'),
      Makefile: 'check:\n\tnpm run verify\n',
      'package.json': pkg({ verify: 'npm run arch', arch: 'depcruise src' }),
    });
    expect(ciInvokes(dir, ['depcruise', 'dependency-cruiser'])).toEqual([
      { file: '.github/workflows/ci.yml', job: 't', chain: ['Makefile:check', 'package.json:verify', 'package.json:arch'] },
    ]);
  });

  it('does not find it one level deeper', () => {
    const dir = repo({
      '.github/workflows/ci.yml': ci('make check'),
      Makefile: 'check:\n\tnpm run verify\n',
      'package.json': pkg({ verify: 'npm run lint', lint: 'npm run arch', arch: 'depcruise src' }),
    });
    expect(ciInvokes(dir, ['depcruise'])).toEqual([]);
  });
});
