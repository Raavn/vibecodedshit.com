import { SEND_TIMEOUT_MS, SUBMIT_URL } from './constants.js';
function readRank(body) {
    try {
        const data = JSON.parse(body);
        if (typeof data.rank !== 'number' || typeof data.total !== 'number')
            return undefined;
        return { rank: data.rank, total: data.total, top10Threshold: typeof data.top10Threshold === 'number' ? data.top10Threshold : null };
    }
    catch {
        return undefined;
    }
}
export async function sendPayload(payload, fetchImpl) {
    try {
        const response = await fetchImpl(SUBMIT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        const body = await response.text();
        if (response.ok)
            return { ok: true, rank: readRank(body) };
        return { ok: false, message: `Server answered ${response.status}: ${body.slice(0, 300)}` };
    }
    catch (err) {
        return { ok: false, message: `Could not send: ${err instanceof Error ? err.message : String(err)}` };
    }
}
