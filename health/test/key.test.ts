import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT, run } from '../src/cli.js';
import { runKeySet } from '../src/commands/key.js';
import { checkKey } from '../src/key/check.js';
import { keyFilePath } from '../src/key/paths.js';
import { materializeFixture } from './helpers/fixture.js';
import { fakeToolKit } from './helpers/tools.js';

function tempHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'health-key-home-'));
}

function writeKeyFile(home: string, value: string): void {
  const file = keyFilePath({}, home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value);
}

const fetchWithStatus = (status: number): typeof fetch => () => Promise.resolve(new Response(null, { status }));
const fetchThatThrows: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));

describe('checkKey', () => {
  it('is missing with no env var and no key file', async () => {
    expect(await checkKey({}, tempHome())).toEqual({ ok: false, reason: 'missing' });
  });

  it('is invalid when the server returns 401', async () => {
    const result = await checkKey({ VIBECODEDSHIT_KEY: 'vcs_bad' }, tempHome(), fetchWithStatus(401));
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('is ok when the server returns 200', async () => {
    const result = await checkKey({ VIBECODEDSHIT_KEY: 'vcs_good' }, tempHome(), fetchWithStatus(200));
    expect(result).toEqual({ ok: true });
  });

  it('runs anyway on a network error', async () => {
    const result = await checkKey({ VIBECODEDSHIT_KEY: 'vcs_good' }, tempHome(), fetchThatThrows);
    expect(result).toEqual({ ok: true });
  });

  it('prefers the env var over the key file', async () => {
    const home = tempHome();
    writeKeyFile(home, 'vcs_from_file');
    let sentKey: string | null = null;
    const fetchImpl: typeof fetch = (_url, init) => {
      sentKey = (init?.headers as Record<string, string>)['x-vcs-key'] ?? null;
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    await checkKey({ VIBECODEDSHIT_KEY: 'vcs_from_env' }, home, fetchImpl);
    expect(sentKey).toBe('vcs_from_env');
  });
});

describe('runKeySet', () => {
  it('writes the key file with mode 0600, creating the directory', () => {
    const home = tempHome();
    const out: string[] = [];
    const code = runKeySet(['set', 'vcs_abc123'], { stdout: (t) => out.push(t), stderr: () => undefined, cwd: home }, { env: {}, home });
    expect(code).toBe(EXIT.ok);
    const file = keyFilePath({}, home);
    expect(readFileSync(file, 'utf8')).toBe('vcs_abc123\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(out.join('')).toContain(file);
  });

  it('rejects a value that does not start with vcs_', () => {
    const home = tempHome();
    const err: string[] = [];
    const code = runKeySet(['set', 'not-a-key'], { stdout: () => undefined, stderr: (t) => err.push(t), cwd: home }, { env: {}, home });
    expect(code).toBe(EXIT.usage);
    expect(err.join('')).toMatch(/vcs_/);
  });
});

describe('health scan CLI: key gate', () => {
  it('exits 6 with the missing-key message when scan has no key', async () => {
    const home = tempHome();
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-key-cwd-'));
    const repo = materializeFixture('typescript');
    const stderr: string[] = [];
    const code = await run(
      ['scan', repo, '--preview'],
      { stdout: () => undefined, stderr: (t) => stderr.push(t), cwd },
      { tools: fakeToolKit(), keyCheck: () => checkKey({}, home) },
    );
    expect(code).toBe(EXIT.key);
    expect(stderr.join('')).toContain('No vibecodedshit key. Get a free one at https://vibecodedshit.com/#run, then run: health key set <key>');
  });

  it('exits 6 with the invalid-key message when the server rejects the key', async () => {
    const home = tempHome();
    writeKeyFile(home, 'vcs_bad');
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-key-cwd-'));
    const repo = materializeFixture('typescript');
    const stderr: string[] = [];
    const code = await run(
      ['scan', repo, '--preview'],
      { stdout: () => undefined, stderr: (t) => stderr.push(t), cwd },
      { tools: fakeToolKit(), keyCheck: () => checkKey({}, home, fetchWithStatus(401)) },
    );
    expect(code).toBe(EXIT.key);
    expect(stderr.join('')).toContain("That vibecodedshit key isn't valid. Get a new one at https://vibecodedshit.com/#run");
  });
});
