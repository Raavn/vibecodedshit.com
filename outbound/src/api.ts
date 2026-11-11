import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Candidate, OwnerContact } from './github.js';
import type { Finding } from './finding.js';

export const DEFAULT_API_BASE = 'https://app.vibecodedshit.com';

export interface LeadPayload extends Finding, OwnerContact {
  repoFullName: string;
  repoUrl: string;
  homepage: string;
  owner: string;
  signal: Candidate['signal'];
  lastPushAt: string;
  health: number;
  band: string;
  run: Record<string, unknown>;
}

/** AIMEKO_TOKEN from the environment, else from ~/ServerRoot/.env.agents. Never printed. */
export function loadToken(env: NodeJS.ProcessEnv = process.env, envFile = path.join(os.homedir(), 'ServerRoot', '.env.agents')): string | null {
  if (env.AIMEKO_TOKEN) return env.AIMEKO_TOKEN;
  try {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?AIMEKO_TOKEN\s*=\s*(.*?)\s*$/.exec(line);
      if (m?.[1]) return m[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // no env file
  }
  return null;
}

/** Upserts one lead through the app's AI API. Re-posting a repo updates the finding and never resets its status. */
export async function postLead(lead: LeadPayload, token: string, base: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${base.replace(/\/$/, '')}/api/ai/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ai-token': token },
    body: JSON.stringify(lead),
  });
  if (!res.ok) throw new Error(`POST /api/ai/leads ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
