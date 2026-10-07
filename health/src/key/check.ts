import { resolveKey } from './resolve.js';

export type KeyCheckResult = { ok: true } | { ok: false; reason: 'missing' | 'invalid' };

const DEFAULT_APP_URL = 'https://app.vibecodedshit.com';

/**
 * No key resolved: `missing`. A key the server rejects with 401: `invalid`. Any other outcome
 * (valid, network error, timeout, or a status other than 401) is `ok: true` — only a 401 proves a
 * made-up key, so the check only ever stops that case.
 */
export async function checkKey(env: NodeJS.ProcessEnv = process.env, home?: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheckResult> {
  const key = resolveKey(env, home);
  if (!key) return { ok: false, reason: 'missing' };
  const appUrl = env.VIBECODEDSHIT_APP_URL?.trim() || DEFAULT_APP_URL;
  try {
    const res = await fetchImpl(`${appUrl}/api/keys/validate`, {
      headers: { 'x-vcs-key': key },
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 401 ? { ok: false, reason: 'invalid' } : { ok: true };
  } catch {
    return { ok: true };
  }
}
