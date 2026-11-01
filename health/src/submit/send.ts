import { SEND_TIMEOUT_MS, SUBMIT_URL } from './constants.js';
import type { SubmissionPayload } from './payload.js';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface RankResult {
  rank: number;
  total: number;
  top10Threshold: number | null;
}

export type SendResult = { ok: true; rank?: RankResult } | { ok: false; message: string };

function readRank(body: string): RankResult | undefined {
  try {
    const data = JSON.parse(body) as Partial<RankResult>;
    if (typeof data.rank !== 'number' || typeof data.total !== 'number') return undefined;
    return { rank: data.rank, total: data.total, top10Threshold: typeof data.top10Threshold === 'number' ? data.top10Threshold : null };
  } catch {
    return undefined;
  }
}

export async function sendPayload(payload: SubmissionPayload, fetchImpl: FetchLike): Promise<SendResult> {
  try {
    const response = await fetchImpl(SUBMIT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = await response.text();
    if (response.ok) return { ok: true, rank: readRank(body) };
    return { ok: false, message: `Server answered ${response.status}: ${body.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, message: `Could not send: ${err instanceof Error ? err.message : String(err)}` };
  }
}
