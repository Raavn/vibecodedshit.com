import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadToken, postLead, type LeadPayload } from './api.js';

describe('loadToken', () => {
  it('prefers the environment', () => {
    expect(loadToken({ AIMEKO_TOKEN: 'env' }, '/nope')).toBe('env');
  });
  it('reads a quoted value from the env file', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tok-')), '.env.agents');
    writeFileSync(file, 'OTHER=1\nAIMEKO_TOKEN="from-file"\n');
    expect(loadToken({}, file)).toBe('from-file');
  });
  it('returns null when absent', () => {
    expect(loadToken({}, '/nope')).toBeNull();
  });
});

describe('postLead', () => {
  const lead = { repoFullName: 'a/b' } as LeadPayload;
  it('sends x-ai-token to /api/ai/leads', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    await postLead(lead, 't', 'http://localhost:3000/', (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    expect(seen?.url).toBe('http://localhost:3000/api/ai/leads');
    expect((seen?.init.headers as Record<string, string>)['x-ai-token']).toBe('t');
  });
  it('throws on a non-2xx answer', async () => {
    await expect(postLead(lead, 't', 'http://x', (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch)).rejects.toThrow('400');
  });
});
