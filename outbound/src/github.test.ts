import { describe, expect, it } from 'vitest';
import { discover, hasMoreCommits, ownerContact, type Gh } from './github.js';

const repo = (name: string, pushed: string, extra: Record<string, unknown> = {}) => ({
  full_name: name,
  html_url: `https://github.com/${name}`,
  homepage: 'https://acme.io',
  pushed_at: pushed,
  fork: false,
  archived: false,
  private: false,
  owner: { login: name.split('/')[0] },
  ...extra,
});

describe('discover', () => {
  it('interleaves signals, drops forks and dedupes', async () => {
    const gh: Gh = async (args) => {
      if (args[0] === 'search/repositories') {
        const q = args.join(' ');
        if (q.includes('Lovable')) {
          return JSON.stringify({ items: [repo('a/one', '2026-11-10T00:00:00Z'), repo('a/fork', '2026-11-09T00:00:00Z', { fork: true }), repo('a/two', '2026-11-08T00:00:00Z')] });
        }
        return JSON.stringify({ items: [repo('b/three', '2026-11-10T00:00:00Z'), repo('a/one', '2026-11-10T00:00:00Z')] });
      }
      throw new Error(`unexpected ${args.join(' ')}`);
    };
    const found = await discover(gh, ['LOVABLE', 'V0'], '2026-10-12', 50);
    expect(found.map((c) => `${c.fullName}:${c.signal}`)).toEqual(['a/one:LOVABLE', 'b/three:V0', 'a/two:LOVABLE']);
  });
});

describe('hasMoreCommits', () => {
  it('is true only past the minimum', async () => {
    expect(await hasMoreCommits(async () => JSON.stringify(new Array(21).fill({})), 'a/b', 20)).toBe(true);
    expect(await hasMoreCommits(async () => JSON.stringify(new Array(20).fill({})), 'a/b', 20)).toBe(false);
    expect(await hasMoreCommits(async () => { throw new Error('404'); }, 'a/b', 20)).toBe(false);
  });
});

describe('ownerContact', () => {
  it('reads the public profile fields only', async () => {
    const c = await ownerContact(async () => JSON.stringify({ email: 'a@b.co', blog: ' ', twitter_username: 'x', login: 'a' }), 'a');
    expect(c).toEqual({ contactEmail: 'a@b.co', contactBlog: null, contactTwitter: 'x' });
  });
});
