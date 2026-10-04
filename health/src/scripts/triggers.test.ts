import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { materializeFixture } from '../../test/helpers/fixture.js';
import { measureFiles, unitsOf, warningsOf } from '../../test/helpers/measure.js';
import { ciCommands } from './ci.js';
import { resetDefaultBranchCache } from './triggers.js';

const repo = (files: Record<string, string>): string => materializeFixture('blank', {}, files);
const wf = (on: string, run: string): string => `on:${on}\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;

/** Per file: whether any of its commands qualifies, and the commands that do. */
function verdicts(dir: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of ciCommands(dir)) out[`${c.file}:${c.job}`] = c.triggers?.qualifies === true;
  return out;
}

describe('ci-github', () => {
  const files = {
    '.github/workflows/a.yml': wf(' pull_request', 'npm run lint'),
    '.github/workflows/b.yml': wf('\n  push:\n    branches: [main]', 'npm test'),
    '.github/workflows/c.yml': wf('\n  push', 'npx tsc --noEmit'),
    '.github/workflows/d.yml': wf('\n  schedule:\n    - cron: "0 0 * * *"', 'vitest run'),
    '.github/workflows/e.yml': wf("\n  push:\n    branches: [main, 'release/**']", 'echo e'),
    '.github/workflows/f.yml': wf('\n  push:\n    branches-ignore: [docs]', 'echo f'),
    '.github/workflows/g.yml': wf("\n  push:\n    tags: ['v*']", 'echo g'),
    '.github/workflows/h.yml': wf(' [pull_request_target]', 'echo h'),
    '.github/workflows/i.yml': wf('\n  workflow_dispatch:', 'echo i'),
    '.github/workflows/j.yml': wf(' push', 'echo j'),
    '.github/workflows/k.yml': wf('\n  push:\n    branches: ["${{ vars.BRANCH }}"]', 'echo k'),
  };

  it('classifies each workflow', () => {
    expect(verdicts(repo(files))).toEqual({
      '.github/workflows/a.yml:t': true,
      '.github/workflows/b.yml:t': false,
      '.github/workflows/c.yml:t': true,
      '.github/workflows/d.yml:t': false,
      '.github/workflows/e.yml:t': true,
      '.github/workflows/f.yml:t': true,
      '.github/workflows/g.yml:t': false,
      '.github/workflows/h.yml:t': true,
      '.github/workflows/i.yml:t': false,
      '.github/workflows/j.yml:t': true,
      '.github/workflows/k.yml:t': true,
    });
  });

  const manifest = { 'package.json': JSON.stringify({ scripts: { lint: 'eslint .', test: 'vitest run' } }) };

  it('6.4 counts only qualifying workflows: lint and typecheck are level 2, tests in B and D do not count', async () => {
    const units = unitsOf(await measureFiles('6.4', { 'src/a.ts': 'export function f() { return 1; }\n', ...manifest, ...files }));
    expect(units.map((u) => u.raw)).toEqual([{ kind: 'level', level: '2' }]);
  });

  it('a push-triggered test job in a qualifying workflow adds the third check; a uses: job adds nothing', async () => {
    const extra = { ...files, '.github/workflows/l.yml': 'on: pull_request\njobs:\n  reuse:\n    uses: ./.github/workflows/x.yml\n  t:\n    steps:\n      - run: pytest\n' };
    const units = unitsOf(await measureFiles('6.4', { 'src/a.ts': 'export function f() { return 1; }\n', ...manifest, ...extra }));
    expect(units[0]?.raw).toEqual({ kind: 'level', level: '3' });
  });

  it('a step with working-directory counts for the packages below it only', async () => {
    const units = unitsOf(
      await measureFiles('6.4', {
        'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
        'packages/a/package.json': '{"name":"a"}',
        'packages/b/package.json': '{"name":"b"}',
        'packages/a/src/x.ts': 'export function f() { return 1; }\n',
        'packages/b/src/y.ts': 'export function g() { return 1; }\n',
        '.github/workflows/ci.yml': 'on: pull_request\njobs:\n  t:\n    steps:\n      - run: tsc --noEmit\n        working-directory: packages/a\n      - run: eslint .\n',
      }),
    );
    expect(Object.fromEntries(units.map((u) => [u.package, u.raw]))).toEqual({
      'packages/a': { kind: 'level', level: '2' },
      'packages/b': { kind: 'level', level: '1' },
    });
  });

  it('no CI files and bare installs give level 0; invalid YAML is skipped with a warning', async () => {
    const none = await measureFiles('6.4', { 'src/a.ts': 'export function f() { return 1; }\n' });
    expect(unitsOf(none)[0]?.raw).toEqual({ kind: 'level', level: '0' });
    const bad = await measureFiles('6.4', { 'src/a.ts': 'export function f() { return 1; }\n', '.github/workflows/a.yml': wf(' pull_request', 'npm ci'), '.gitlab-ci.yml': 'a: [\n' });
    expect(unitsOf(bad)[0]?.raw).toEqual({ kind: 'level', level: '0' });
    expect(warningsOf(bad).join('\n')).toContain('.gitlab-ci.yml: invalid YAML');
  });
});

describe('ci-gitlab', () => {
  it('a job with no rules and a merge_request_event rule qualify; a default-branch-only rule does not', () => {
    const dir = repo({
      '.gitlab-ci.yml': [
        'plain:', '  script: [a]',
        'mr:', '  script: [b]', '  rules:', '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
        'main_only:', '  script: [c]', '  rules:', '    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
        'named:', '  script: [d]', '  rules:', '    - if: $CI_COMMIT_BRANCH == "main"',
        'only_main:', '  script: [e]', '  only: [main]',
        'only_mr:', '  script: [f]', '  only: [merge_requests]',
        'never:', '  script: [g]', '  rules:', '    - if: $CI_COMMIT_TAG', '      when: never',
        'bare_rule:', '  script: [h]', '  rules:', '    - when: always',
      ].join('\n'),
    });
    expect(verdicts(dir)).toEqual({
      '.gitlab-ci.yml:plain': true,
      '.gitlab-ci.yml:mr': true,
      '.gitlab-ci.yml:main_only': false,
      '.gitlab-ci.yml:named': false,
      '.gitlab-ci.yml:only_main': false,
      '.gitlab-ci.yml:only_mr': true,
      '.gitlab-ci.yml:never': false,
      '.gitlab-ci.yml:bare_rule': true,
    });
  });
});

describe('ci-circleci', () => {
  it('a workflow job limited to the default branch, or in a schedule workflow, does not qualify; an unfiltered one does', () => {
    const dir = repo({
      '.circleci/config.yml': [
        'version: 2.1', 'jobs:', '  build:', '    steps: [{ run: a }]', '  deploy:', '    steps: [{ run: b }]', '  nightly:', '    steps: [{ run: c }]', '  orphan:', '    steps: [{ run: d }]',
        'workflows:', '  main:', '    jobs:', '      - build', '      - deploy:', '          filters:', '            branches:', '              only: main',
        '  cron:', '    triggers:', '      - schedule:', '          cron: "0 0 * * *"', '    jobs:', '      - nightly',
      ].join('\n'),
    });
    expect(verdicts(dir)).toEqual({
      '.circleci/config.yml:build': true,
      '.circleci/config.yml:deploy': false,
      '.circleci/config.yml:nightly': false,
      '.circleci/config.yml:orphan': false,
    });
  });

  it('a legacy config with no workflows key qualifies', () => {
    expect(verdicts(repo({ '.circleci/config.yml': 'version: 2\njobs:\n  build:\n    steps: [{ run: a }]\n' }))).toEqual({ '.circleci/config.yml:build': true });
  });
});

describe('ci-bitbucket', () => {
  it('default and pull-requests qualify; branches limited to the default branch, custom and tags do not', () => {
    const step = (name: string): string => `        - step:\n            name: ${name}\n            script:\n              - ${name}\n`;
    const dir = repo({
      'bitbucket-pipelines.yml': `pipelines:\n  default:\n${step('d')}  pull-requests:\n    '**':\n${step('p')}  branches:\n    main:\n${step('m')}  custom:\n    nightly:\n${step('c')}  tags:\n    'v*':\n${step('t')}`,
    });
    const got = ciCommands(dir).map((c) => [c.command, c.triggers?.qualifies]);
    expect(got).toEqual([['d', true], ['p', true], ['m', false], ['c', false], ['t', false]]);
  });

  it('branches with a non-default key qualify', () => {
    const dir = repo({ 'bitbucket-pipelines.yml': 'pipelines:\n  branches:\n    main:\n      - step:\n          script: [a]\n    feature/*:\n      - step:\n          script: [b]\n' });
    expect(ciCommands(dir).map((c) => c.triggers?.qualifies)).toEqual([true, true]);
  });
});

describe('ci-azure', () => {
  it('a pr trigger qualifies; trigger none and a default-branch-only trigger do not', () => {
    const file = (head: string): string => `${head}\nsteps:\n  - script: a\n`;
    expect(ciCommands(repo({ 'azure-pipelines.yml': file('pr:\n  branches:\n    include: [main]') })).map((c) => c.triggers?.qualifies)).toEqual([true]);
    expect(ciCommands(repo({ 'azure-pipelines.yml': file('trigger: none') })).map((c) => c.triggers?.qualifies)).toEqual([false]);
    expect(ciCommands(repo({ 'azure-pipelines.yml': file('trigger: [main]') })).map((c) => c.triggers?.qualifies)).toEqual([false]);
    expect(ciCommands(repo({ 'azure-pipelines.yml': file('trigger:\n  branches:\n    include: [main, develop]') })).map((c) => c.triggers?.qualifies)).toEqual([true]);
    expect(ciCommands(repo({ 'azure-pipelines.yml': file('') })).map((c) => c.triggers?.qualifies)).toEqual([true]);
  });
});

describe('default branch detection', () => {
  it('takes the target of origin/HEAD, so a push limited to develop does not qualify', () => {
    const dir = repo({ '.github/workflows/a.yml': wf('\n  push:\n    branches: [develop]', 'echo a') });
    expect(verdicts(dir)['.github/workflows/a.yml:t']).toBe(true);
    // update-ref needs a commit.
    spawnSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-q', '-m', 'x'], { encoding: 'utf8' });
    for (const args of [['update-ref', 'refs/remotes/origin/develop', 'HEAD'], ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop']]) {
      expect(spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).status).toBe(0);
    }
    resetDefaultBranchCache();
    expect(verdicts(dir)['.github/workflows/a.yml:t']).toBe(false);
  });
});
