import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readRun, RunReadError } from '../run/read.js';
import { EMAIL_PATTERN, MAX_EMAIL_CHARS, MAX_PAYLOAD_BYTES, MAX_SUMMARY_CHARS } from '../submit/constants.js';
import { buildPayload, PayloadError } from '../submit/payload.js';
import { type GitRunner, repoIdentity, RepoIdentityError } from '../submit/repo-identity.js';
import { type FetchLike, sendPayload } from '../submit/send.js';
import { EXIT, type CliIo } from './common.js';

export const SUBMIT_USAGE = 'Usage: health submit <run.json> --email <addr> [--confirm] [--newsletter] [--include-repo-name] [--summary-file <path>]\n';

/** Test seams: the git runner and `fetch`. */
export interface SubmitDeps {
  git?: GitRunner;
  fetch?: FetchLike;
}

export const defaultGit: GitRunner = (repoPath, args) =>
  new Promise((resolve) => {
    execFile('git', ['-C', repoPath, ...args], { encoding: 'utf8' }, (err, stdout) => resolve(err ? null : stdout));
  });

export async function runSubmit(argv: string[], io: CliIo, deps: SubmitDeps = {}): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        confirm: { type: 'boolean' },
        newsletter: { type: 'boolean' },
        'include-repo-name': { type: 'boolean' },
        email: { type: 'string' },
        'summary-file': { type: 'string' },
      },
    });
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n${SUBMIT_USAGE}`);
    return EXIT.usage;
  }
  const [runFile] = parsed.positionals;
  if (!runFile || parsed.positionals.length > 1) {
    io.stderr(SUBMIT_USAGE);
    return EXIT.usage;
  }
  const refuse = (message: string): number => {
    io.stderr(`${message}\n`);
    return EXIT.usage;
  };

  const email = parsed.values.email;
  if (email === undefined) return refuse('--email is required.');
  if (email.length > MAX_EMAIL_CHARS || !EMAIL_PATTERN.test(email)) return refuse('--email is not a valid address.');

  let run;
  try {
    run = readRun(path.resolve(io.cwd, runFile));
  } catch (err) {
    if (err instanceof RunReadError) return refuse(err.message);
    throw err;
  }
  if (run.mode !== 'full') {
    return refuse('Preview runs are not comparable and cannot be submitted. Run a full scan (Docker required) and submit that run.');
  }
  if (!run.valid) return refuse(`run.json is invalid: ${run.invalidReason ?? 'no reason given'}.`);
  if (!run.comparable) return refuse(`This run is not comparable: ${run.comparableReason ?? 'no reason given'}.`);

  let summary: string | undefined;
  const summaryFile = parsed.values['summary-file'];
  if (summaryFile !== undefined) {
    try {
      summary = readFileSync(path.resolve(io.cwd, summaryFile), 'utf8').trim();
    } catch (err) {
      return refuse(`Cannot read the summary file: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (summary === '') return refuse('The summary file is empty.');
    if (summary.length > MAX_SUMMARY_CHARS) return refuse(`The summary is longer than ${MAX_SUMMARY_CHARS} characters, the server limit.`);
    const paths = [run.repo.path, ...run.parameters.flatMap((p) => (p.units ?? []).map((u) => u.package))].filter((p) => p !== '' && p !== '.');
    if (paths.some((p) => summary?.includes(p))) return refuse('The summary contains a file path. Remove it and try again.');
  }

  let identity;
  try {
    identity = await repoIdentity(run.repo.path, deps.git ?? defaultGit);
  } catch (err) {
    if (err instanceof RepoIdentityError) return refuse(err.message);
    throw err;
  }

  let payload;
  try {
    payload = buildPayload({
      run,
      repoHash: identity.hash,
      repoName: parsed.values['include-repo-name'] ? identity.name : undefined,
      summary,
      email,
      newsletter: parsed.values.newsletter,
    });
  } catch (err) {
    if (err instanceof PayloadError) return refuse(err.message);
    throw err;
  }

  const body = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) return refuse('Payload is larger than 64 KB, the server limit.');
  io.stdout(`${body}\n`);

  if (!parsed.values.confirm) {
    io.stdout('Not sent. Add --confirm to send.\n');
    return EXIT.ok;
  }
  const result = await sendPayload(payload, deps.fetch ?? (fetch as unknown as FetchLike));
  if (!result.ok) {
    io.stderr(`${result.message}\n`);
    return EXIT.sendFailed;
  }
  io.stdout('Submitted. Thank you.\n');
  if (result.rank) {
    const { rank, total, top10Threshold } = result.rank;
    io.stdout(`Rank ${rank} of ${total}.${top10Threshold === null ? '' : ` Top 10 starts at ${top10Threshold}.`}\n`);
  }
  return EXIT.ok;
}
