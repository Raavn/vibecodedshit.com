import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EXIT, run } from '../src/cli.js';
import type { RunFile } from '../src/run/schema.js';
import { normalizeRemote, repoIdentity, type GitRunner } from '../src/submit/repo-identity.js';
import type { FetchLike } from '../src/submit/send.js';
import { materializeFixture } from './helpers/fixture.js';
import { makeRun } from './helpers/run.js';

const dir = mkdtempSync(path.join(tmpdir(), 'health-submit-'));
let counter = 0;

function save(runFile: RunFile): string {
  counter += 1;
  const file = path.join(dir, `run-${counter}.json`);
  writeFileSync(file, JSON.stringify(runFile));
  return file;
}

function gitFor(remotes: Record<string, string>, root = 'c'.repeat(40)): GitRunner {
  return async (_repo, args) => {
    if (args[0] === 'remote' && args.length === 1) return Object.keys(remotes).join('\n');
    if (args[0] === 'remote' && args[1] === 'get-url') return remotes[args[2] ?? ''] ?? null;
    if (args[0] === 'rev-list') return `${root}\n`;
    return null;
  };
}

const okResponse = { ok: true, status: 201, text: async () => '{}' };

function mockFetch(response: { ok: boolean; status: number; text: () => Promise<string> } = okResponse) {
  return vi.fn<FetchLike>(async () => response);
}

async function submit(file: string, flags: string[], deps: { git?: GitRunner; fetch?: FetchLike } = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(['submit', file, ...flags], { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd: dir }, { git: gitFor({ origin: 'git@github.com:Org/Repo.git' }), ...deps });
  return { code, stdout, stderr };
}

/** The JSON object printed before the "Not sent" or "Submitted" line. */
function printed(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.slice(0, stdout.lastIndexOf('}') + 1)) as Record<string, unknown>;
}

const secretRun = makeRun({
  repo: { path: '/Users/x/secret', headCommit: 'a'.repeat(40), treeHash: 'b'.repeat(40) },
  scope: { logicFiles: 1, logicLines: 10, sourceLines: 10, packages: ['packages/api'] },
  warnings: ['packages/api/src/index.ts has a problem'],
  breakdown: { byPackage: { 'packages/api': { '4': 80 } }, byGroup: {} },
  parameters: [
    {
      id: '4.2',
      status: 'measured',
      weight: 1,
      raw: { kind: 'ratio', numerator: 1, denominator: 4, scale: 100 },
      score: 75.123456,
      units: [{ package: 'packages/api', group: 'typescript_javascript', weight: 1, raw: { kind: 'ratio', numerator: 1, denominator: 4, scale: 100 }, score: 75 }],
    },
    { id: '6.5', status: 'not_applicable', weight: 1, reason: 'no env reads in /Users/x/secret' },
  ],
});

describe('submit: payload', () => {
  it('contains no file paths, units or breakdown', async () => {
    const out = await submit(save(secretRun), []);
    expect(out.code).toBe(EXIT.ok);
    expect(out.stdout).not.toContain('/Users/x/secret');
    expect(out.stdout).not.toContain('packages/api');
    expect(out.stdout).not.toContain('units');
    expect(out.stdout).not.toContain('breakdown');
    expect(printed(out.stdout).parameters).toEqual([
      { id: '4.2', status: 'measured', raw: { kind: 'ratio', numerator: 1, denominator: 4, scale: 100 }, score: 75.123456 },
      { id: '6.5', status: 'not_applicable' },
    ]);
  });

  it('copies values unchanged from run.json', async () => {
    const runFile = makeRun({ scores: [71.4, 70, 70, 70, 70, 70] });
    const payload = printed((await submit(save(runFile), [])).stdout);
    expect(payload.methodologyVersion).toBe('1.0');
    expect(payload.imageDigest).toBe('sha256:abc');
    expect(payload.asOf).toBe('2026-10-04');
    expect(payload.health).toBe(runFile.health?.displayed);
    expect(payload.band).toBe(runFile.health?.band);
    expect((payload.dimensions as { id: number; score: number }[])[0]).toEqual({ id: 1, score: 71.4 });
  });

  it('leaves repoName and email out unless their flags are given', async () => {
    const file = save(makeRun());
    const plain = printed((await submit(file, [])).stdout);
    expect(plain).not.toHaveProperty('repoName');
    expect(plain).not.toHaveProperty('email');
    expect(plain).not.toHaveProperty('summary');
    const full = printed((await submit(file, ['--include-repo-name', '--email', 'a@b.co'])).stdout);
    expect(full.repoName).toBe('org/repo');
    expect(full.email).toBe('a@b.co');
  });

  it('sends the summary text when a summary file is given', async () => {
    const summaryFile = path.join(dir, 'summary.txt');
    writeFileSync(summaryFile, '  Tests are thin.  \n');
    const out = await submit(save(makeRun()), ['--summary-file', summaryFile]);
    expect(printed(out.stdout).summary).toBe('Tests are thin.');
  });
});

describe('submit: sending', () => {
  it('sends nothing without --confirm', async () => {
    const fetchMock = mockFetch();
    const out = await submit(save(makeRun()), [], { fetch: fetchMock });
    expect(out.code).toBe(EXIT.ok);
    expect(out.stdout).toContain('Not sent. Add --confirm to send.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the printed payload once with --confirm', async () => {
    const fetchMock = mockFetch();
    const out = await submit(save(makeRun()), ['--confirm'], { fetch: fetchMock });
    expect(out.code).toBe(EXIT.ok);
    expect(out.stdout).toContain('Submitted. Thank you.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://app.vibecodedshit.com/api/submissions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init?.body ?? '')).toEqual(printed(out.stdout));
  });

  it('prints the server reason and exits 6 on a 400', async () => {
    const fetchMock = mockFetch({ ok: false, status: 400, text: async () => '{"error":"health does not match"}' });
    const out = await submit(save(makeRun()), ['--confirm'], { fetch: fetchMock });
    expect(out.code).toBe(EXIT.sendFailed);
    expect(out.stderr).toContain('400');
    expect(out.stderr).toContain('health does not match');
  });

  it('exits 6 on a network error', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new Error('connection refused');
    });
    const out = await submit(save(makeRun()), ['--confirm'], { fetch: fetchMock });
    expect(out.code).toBe(EXIT.sendFailed);
    expect(out.stderr).toContain('connection refused');
  });
});

describe('submit: refusals', () => {
  async function refused(runFile: RunFile | string, flags: string[] = []): Promise<string> {
    const fetchMock = mockFetch();
    const out = await submit(typeof runFile === 'string' ? runFile : save(runFile), ['--confirm', ...flags], { fetch: fetchMock });
    expect(out.code).toBe(EXIT.usage);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.stdout).toBe('');
    return out.stderr;
  }

  it('refuses a preview run and says why', async () => {
    const message = await refused(makeRun({ mode: 'preview', comparable: false }));
    expect(message).toContain('Preview runs are not comparable');
  });

  it('refuses an invalid run', async () => {
    expect(await refused(makeRun({ valid: false, invalidReason: 'docker failed' }))).toContain('run.json is invalid: docker failed.');
  });

  it('refuses a run that is not comparable', async () => {
    expect(await refused(makeRun({ comparable: false, comparableReason: 'parameter 1.1 not measured' }))).toContain('This run is not comparable: parameter 1.1 not measured.');
  });

  it('refuses a run with no image digest', async () => {
    expect(await refused(makeRun({ tools: { image: undefined } }))).toContain('image digest');
  });

  it('refuses a run with no health score', async () => {
    expect(await refused(makeRun({ health: null }))).toContain('no health score');
  });

  it('refuses an unreadable run file', async () => {
    expect(await refused(path.join(dir, 'missing.json'))).toContain('cannot read');
  });

  it('refuses an oversized payload', async () => {
    const big = makeRun({ parameters: [{ id: '1.1', status: 'measured', weight: 1, raw: { kind: 'number', value: 1, big: 'x'.repeat(70000) } as never, score: 1 }] });
    expect(await refused(big)).toContain('larger than 64 KB');
  });

  it('refuses a summary that contains a package path', async () => {
    const summaryFile = path.join(dir, 'leaky.txt');
    writeFileSync(summaryFile, 'The worst code is in packages/api.');
    expect(await refused(secretRun, ['--summary-file', summaryFile])).toContain('file path');
  });

  it('refuses an empty summary file', async () => {
    const summaryFile = path.join(dir, 'empty.txt');
    writeFileSync(summaryFile, '\n');
    expect(await refused(makeRun(), ['--summary-file', summaryFile])).toContain('empty');
  });

  it('refuses a malformed email', async () => {
    expect(await refused(makeRun(), ['--email', 'not-an-email'])).toContain('--email');
  });

  it('refuses when the repository identity cannot be determined', async () => {
    const out = await submit(save(makeRun()), [], { git: async () => null });
    expect(out.code).toBe(EXIT.usage);
    expect(out.stderr).toContain('cannot determine the repository identity');
  });

  it('prints usage without a run file', async () => {
    let stderr = '';
    const code = await run(['submit'], { stdout: () => undefined, stderr: (t) => (stderr += t), cwd: dir });
    expect(code).toBe(EXIT.usage);
    expect(stderr).toContain('Usage: health submit');
  });
});

describe('repo identity', () => {
  const urls = [
    'git@github.com:Org/Repo.git',
    'ssh://git@github.com:22/org/repo',
    'https://github.com/org/repo',
    'https://user:token@GitHub.com/org/repo/',
  ];

  it('normalises the SSH and HTTPS forms of one remote to the same string', () => {
    expect(urls.map(normalizeRemote)).toEqual(Array<string>(4).fill('github.com/org/repo'));
  });

  it('gives the same hash for every form and a different hash for another repository', async () => {
    const hashes = await Promise.all(urls.map(async (url) => (await repoIdentity('/r', gitFor({ origin: url }))).hash));
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect((await repoIdentity('/r', gitFor({ origin: 'https://github.com/org/other' }))).hash).not.toBe(hashes[0]);
  });

  it('prefers origin, else the first remote', async () => {
    const withOrigin = await repoIdentity('/r', gitFor({ upstream: 'https://github.com/a/b', origin: 'https://github.com/org/repo' }));
    expect(withOrigin.name).toBe('org/repo');
    const noOrigin = await repoIdentity('/r', gitFor({ upstream: 'https://github.com/a/b' }));
    expect(noOrigin.name).toBe('a/b');
  });

  it('falls back to a hash of the root commit when there is no remote', async () => {
    const identity = await repoIdentity('/work/myrepo', gitFor({}, 'ABCDEF'.padEnd(40, '0')));
    expect(identity.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.name).toBe('myrepo');
    expect(identity.hash).not.toBe((await repoIdentity('/work/myrepo', gitFor({}, '1'.repeat(40)))).hash);
  });

  it('reads a real repository remote and root commit', async () => {
    const repo = materializeFixture('exec-tests-vitest');
    const git = (args: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t.t', ...args], { encoding: 'utf8' });
    git(['commit', '-q', '-m', 'init']);
    const { defaultGit } = await import('../src/commands/submit.js');
    const bare = await repoIdentity(repo, defaultGit);
    expect(bare.hash).toMatch(/^[0-9a-f]{64}$/);
    git(['remote', 'add', 'origin', 'git@github.com:Org/Repo.git']);
    const withRemote = await repoIdentity(repo, defaultGit);
    expect(withRemote.hash).toBe((await repoIdentity('/r', gitFor({ origin: 'https://github.com/org/repo' }))).hash);
  });
});
