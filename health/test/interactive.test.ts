import { describe, expect, it, vi } from 'vitest';
import type { CliIo } from '../src/commands/common.js';
import { afterScan } from '../src/interactive/after-scan.js';
import { setUpDocker } from '../src/interactive/docker-setup.js';
import type { Prompter } from '../src/interactive/prompt.js';
import type { System } from '../src/interactive/system.js';
import { loadMethodology } from '../src/methodology/load.js';
import { ToolError } from '../src/scope/types.js';
import { PRIVACY_URL, QUOTE_URL, SUBMIT_URL } from '../src/submit/constants.js';
import type { GitRunner } from '../src/submit/repo-identity.js';
import type { FetchLike } from '../src/submit/send.js';
import { makeRun } from './helpers/run.js';

const methodology = loadMethodology('1.0');

function capture(): CliIo & { out: () => string; err: () => string } {
  let stdout = '';
  let stderr = '';
  return {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    cwd: '/tmp',
    out: () => stdout,
    err: () => stderr,
  };
}

/** Answers confirms and text questions in order. */
function answers(confirms: boolean[], texts: string[] = []): Prompter & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    confirm: async (q) => {
      asked.push(q);
      return confirms.shift() ?? false;
    },
    text: async (q) => {
      asked.push(q);
      return texts.shift() ?? '';
    },
  };
}

/** A host where each command's exit code comes from `codes` (`docker info` can change over time). */
function fakeSystem(codes: Record<string, (number | null)[] | number | null>, platform: NodeJS.Platform = 'darwin'): System & { calls: string[] } {
  const calls: string[] = [];
  return {
    platform,
    calls,
    exec: async (command, args) => {
      const key = `${command} ${args[0] ?? ''}`.trim();
      calls.push(`${command} ${args.join(' ')}`);
      const code = codes[key];
      if (Array.isArray(code)) return code.length > 1 ? (code.shift() ?? 0) : (code[0] ?? 0);
      return code === undefined ? 0 : code;
    },
    sleep: async () => {},
  };
}

const missingImage = async (): Promise<string> => {
  throw new ToolError('image health:1.0 is not available');
};

describe('setUpDocker', () => {
  it('falls back to preview when Docker is missing and the user says No', async () => {
    const system = fakeSystem({ 'docker --version': null });
    const prompt = answers([false]);
    const setup = await setUpDocker('health:1.0', { io: capture(), prompt, system, packageRoot: '/pkg', imageDigest: missingImage });
    expect(setup).toEqual({ previewReason: 'Docker is not installed.' });
    expect(system.calls).toEqual(['docker --version']);
  });

  it('installs with Homebrew, starts Docker and uses the image when the user says Yes', async () => {
    const system = fakeSystem({ 'docker --version': null, 'docker info': [1, 0] });
    const setup = await setUpDocker('health:1.0', { io: capture(), prompt: answers([true]), system, packageRoot: '/pkg', imageDigest: async () => 'sha256:x' });
    expect(setup).toEqual({ digest: 'sha256:x' });
    expect(system.calls).toContain('brew install --cask docker-desktop');
    expect(system.calls).toContain('open -a Docker');
  });

  it('says where to download Docker on a Mac without Homebrew', async () => {
    const system = fakeSystem({ 'docker --version': null, 'brew --version': null });
    const io = capture();
    const setup = await setUpDocker('health:1.0', { io, prompt: answers([true]), system, packageRoot: '/pkg', imageDigest: missingImage });
    expect(setup).toEqual({ previewReason: 'Docker could not be installed.' });
    expect(io.err()).toContain('docker-desktop');
  });

  it('asks to start Docker when it is installed but not running', async () => {
    const system = fakeSystem({ 'docker info': 1 });
    const prompt = answers([false]);
    const setup = await setUpDocker('health:1.0', { io: capture(), prompt, system, packageRoot: '/pkg', imageDigest: missingImage });
    expect(setup).toEqual({ previewReason: 'Docker is not running.' });
    expect(prompt.asked[0]).toContain('not running');
  });

  it('gives up when Docker does not start in time', async () => {
    const system = fakeSystem({ 'docker info': 1 }, 'linux');
    const setup = await setUpDocker('health:1.0', { io: capture(), prompt: answers([true]), system, packageRoot: '/pkg', imageDigest: missingImage });
    expect(setup).toMatchObject({ previewReason: expect.stringContaining('usermod -aG docker') });
  });

  it('builds the image when it is missing and the user says Yes', async () => {
    const system = fakeSystem({});
    const digest = vi.fn<(tag: string) => Promise<string>>().mockRejectedValueOnce(new ToolError('missing')).mockResolvedValueOnce('sha256:new');
    const setup = await setUpDocker('health:1.0', { io: capture(), prompt: answers([true]), system, packageRoot: '/pkg', imageDigest: digest });
    expect(setup).toEqual({ digest: 'sha256:new' });
    expect(system.calls).toContain('docker build -t health:1.0 -f /pkg/docker/Dockerfile /pkg/docker');
  });

  it('runs a preview when the user declines the image build', async () => {
    const prompt = answers([false]);
    const setup = await setUpDocker('health:1.0', { io: capture(), prompt, system: fakeSystem({}), packageRoot: '/pkg', imageDigest: missingImage });
    expect(setup).toEqual({ previewReason: 'The scan image health:1.0 is not built yet.' });
  });
});

const git: GitRunner = async (_repo, args) => {
  if (args[0] === 'remote' && args.length === 1) return 'origin';
  if (args[0] === 'remote' && args[1] === 'get-url') return 'https://github.com/acme/app.git';
  return null;
};

function okFetch() {
  return vi.fn<FetchLike>(async () => ({ ok: true, status: 201, text: async () => '{"rank":3,"total":10,"top10Threshold":50}' }));
}

describe('afterScan', () => {
  it('submits to the leaderboard after a yes and an email', async () => {
    const fetch = okFetch();
    const io = capture();
    await afterScan(makeRun(), methodology, { io, prompt: answers([true], ['me@example.com']), git, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(SUBMIT_URL);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body ?? '{}')).toMatchObject({ email: 'me@example.com' });
    expect(io.out()).toContain(PRIVACY_URL);
    expect(io.out()).toContain('Rank 3 of 10');
  });

  it('sends nothing when the user says No', async () => {
    const fetch = okFetch();
    await afterScan(makeRun({ scores: [30, 30, 30, 30, 30, 30] }), methodology, { io: capture(), prompt: answers([false, false]), git, fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not offer the leaderboard for a preview run but still offers a quote to a Fragile app', async () => {
    const fetch = okFetch();
    const io = capture();
    const prompt = answers([true], ['Ada', 'ada@example.com', 'Launch next month']);
    await afterScan(makeRun({ mode: 'preview', comparable: false, scores: [50, 50, 50, 50, 50, 50] }), methodology, { io, prompt, git, fetch });
    expect(io.out()).toContain('cannot go on the global leaderboard');
    expect(prompt.asked[0]).toBe('Do you want to ask for a quote?');
    expect(fetch.mock.calls[0]?.[0]).toBe(QUOTE_URL);
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body ?? '{}');
    expect(body).toMatchObject({ contact: { name: 'Ada', email: 'ada@example.com', note: 'Launch next month' }, band: 'fragile', health: 50 });
    expect(body.repoHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.report).toContain('<html');
    expect(io.out()).toContain('Peter will reply by email');
  });

  it('reuses the leaderboard email for the quote', async () => {
    const fetch = okFetch();
    const prompt = answers([true, true], ['me@example.com', 'Me', '']);
    await afterScan(makeRun({ scores: [30, 30, 30, 30, 30, 30] }), methodology, { io: capture(), prompt, git, fetch });
    expect(prompt.asked.filter((q) => q === 'Your email:')).toHaveLength(1);
    expect(fetch.mock.calls[1]?.[0]).toBe(QUOTE_URL);
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body ?? '{}').contact).toEqual({ name: 'Me', email: 'me@example.com' });
  });

  it('does not offer a quote to a Stable app', async () => {
    const prompt = answers([false]);
    await afterScan(makeRun(), methodology, { io: capture(), prompt, git, fetch: okFetch() });
    expect(prompt.asked).toEqual(['Submit your score to the global leaderboard?']);
  });
});
