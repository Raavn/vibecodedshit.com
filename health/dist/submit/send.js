import { SEND_TIMEOUT_MS, SUBMIT_URL } from './constants.js';
export async function sendPayload(payload, fetchImpl) {
    try {
        const response = await fetchImpl(SUBMIT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (response.ok)
            return { ok: true };
        const body = await response.text();
        return { ok: false, message: `Server answered ${response.status}: ${body.slice(0, 300)}` };
    }
    catch (err) {
        return { ok: false, message: `Could not send: ${err instanceof Error ? err.message : String(err)}` };
    }
}
