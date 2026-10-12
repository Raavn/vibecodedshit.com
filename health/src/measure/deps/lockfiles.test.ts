import { describe, expect, it } from 'vitest';
import { chooseJsLockfile, jsLockfiles } from './lockfiles.js';

describe('JS lockfile choice', () => {
  it('follows the install preference order', () => {
    expect(chooseJsLockfile(['package-lock.json', 'bun.lock', 'deno.lock'])).toBe('bun.lock');
    expect(chooseJsLockfile(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])).toBe('pnpm-lock.yaml');
    expect(chooseJsLockfile(['package-lock.json', 'bun.lockb'])).toBe('bun.lockb');
    expect(chooseJsLockfile(['package-lock.json'])).toBe('package-lock.json');
    expect(chooseJsLockfile(['README.md'])).toBeUndefined();
  });

  it('lists only JS lockfiles, in preference order', () => {
    expect(jsLockfiles(['package-lock.json', 'uv.lock', 'bun.lock', 'deno.lock'])).toEqual(['bun.lock', 'package-lock.json']);
  });
});
