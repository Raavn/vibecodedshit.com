import { renderReport } from '../report/render.js';
import { EMAIL_PATTERN, MAX_EMAIL_CHARS, MAX_PAYLOAD_BYTES, PRIVACY_URL, QUOTE_URL } from '../submit/constants.js';
import { buildPayload, PayloadError } from '../submit/payload.js';
import { repoIdentity, RepoIdentityError } from '../submit/repo-identity.js';
import { sendPayload } from '../submit/send.js';
/** Bands whose owners are offered a quote for the fixing service. */
const QUOTE_BANDS = new Set(['vibe_coded', 'fragile']);
const QUOTE_TIMEOUT_MS = 30_000;
async function askEmail(prompt, io) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const email = await prompt.text('Your email:');
        if (email.length <= MAX_EMAIL_CHARS && EMAIL_PATTERN.test(email))
            return email;
        io.stderr('That is not a valid email address.\n');
    }
    return null;
}
async function submitToLeaderboard(run, ctx, emailFor) {
    const { io, prompt } = ctx;
    if (run.mode !== 'full' || !run.comparable) {
        const why = run.mode === 'full' ? (run.comparableReason ?? 'not comparable') : 'a preview scan, a full scan with Docker is needed';
        io.stdout(`This run cannot go on the global leaderboard: ${why}.\n`);
        return;
    }
    io.stdout(`The leaderboard gets your scores, a hash of your repository URL and your email. No code, no file paths. Privacy: ${PRIVACY_URL}\n`);
    if (!(await prompt.confirm('Submit your score to the global leaderboard?')))
        return;
    const email = await emailFor();
    if (email === null)
        return;
    try {
        const identity = await repoIdentity(run.repo.path, ctx.git);
        const payload = buildPayload({ run, repoHash: identity.hash, email });
        if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
            io.stderr('Not submitted: the payload is larger than 64 KB, the server limit.\n');
            return;
        }
        const result = await sendPayload(payload, ctx.fetch);
        if (!result.ok) {
            io.stderr(`Not submitted. ${result.message}\n`);
            return;
        }
        const rank = result.rank;
        const rankLine = rank ? ` Rank ${rank.rank} of ${rank.total}.${rank.top10Threshold === null ? '' : ` Top 10 starts at ${rank.top10Threshold}.`}` : '';
        io.stdout(`Submitted.${rankLine}\n`);
    }
    catch (err) {
        if (err instanceof RepoIdentityError || err instanceof PayloadError) {
            io.stderr(`Not submitted: ${err.message}\n`);
            return;
        }
        throw err;
    }
}
async function requestQuote(run, methodology, ctx, emailFor) {
    const { io, prompt } = ctx;
    if (!run.health || !QUOTE_BANDS.has(run.health.band))
        return;
    const bandName = methodology.bands.find((b) => b.key === run.health?.band)?.name ?? run.health.band;
    io.stdout(`\nYour app is ${bandName}. Peter, the creator of this scan, runs a service that fixes vibe-coded apps.\n`);
    io.stdout('A quote request sends your name, email, run.json and the HTML report (scores and file paths, no source code).\n');
    if (!(await prompt.confirm('Do you want to ask for a quote?')))
        return;
    const name = await prompt.text('Your name:');
    if (name === '') {
        io.stderr('A name is needed for the quote request. Nothing was sent.\n');
        return;
    }
    const email = await emailFor();
    if (email === null)
        return;
    const note = await prompt.text('Anything Peter should know? (optional, press Enter to skip)');
    let repoHash;
    try {
        repoHash = (await repoIdentity(run.repo.path, ctx.git)).hash;
    }
    catch (err) {
        if (!(err instanceof RepoIdentityError))
            throw err;
        io.stderr(`Nothing was sent: ${err.message}\n`);
        return;
    }
    const body = {
        contact: { name, email, ...(note === '' ? {} : { note }) },
        methodologyVersion: run.methodology.version,
        health: run.health.displayed,
        band: run.health.band,
        repoHash,
        run,
        report: renderReport(run, methodology),
    };
    try {
        const response = await ctx.fetch(QUOTE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
        });
        if (response.ok) {
            io.stdout('Quote requested. Peter will reply by email.\n');
            return;
        }
        io.stderr(`The quote request failed (${response.status}): ${(await response.text()).slice(0, 300)}. Reach Peter at https://vibecodedshit.com\n`);
    }
    catch (err) {
        io.stderr(`The quote request failed: ${err instanceof Error ? err.message : String(err)}. Reach Peter at https://vibecodedshit.com\n`);
    }
}
/** After an interactive scan: offer the leaderboard, then a quote for Vibe-coded and Fragile apps. Nothing is sent without a yes. */
export async function afterScan(run, methodology, ctx) {
    if (!run.valid)
        return;
    let email;
    const emailFor = async () => {
        if (email === undefined)
            email = await askEmail(ctx.prompt, ctx.io);
        return email;
    };
    await submitToLeaderboard(run, ctx, emailFor);
    await requestQuote(run, methodology, ctx, emailFor);
}
