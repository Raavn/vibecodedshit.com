import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultGit } from '../../health/src/commands/submit.js';
import { CURRENT_METHODOLOGY_VERSION, loadMethodology } from '../../health/src/methodology/load.js';
import { NoLogicFilesError, runScan } from '../../health/src/run/scan.js';
import { EMAIL_PATTERN, MAX_PAYLOAD_BYTES } from '../../health/src/submit/constants.js';
import { buildPayload } from '../../health/src/submit/payload.js';
import { repoIdentity } from '../../health/src/submit/repo-identity.js';
import { type FetchLike, sendPayload } from '../../health/src/submit/send.js';
import { findRepos } from './repos.js';

const USAGE = `Usage: npm --prefix outbound run own -- --email <addr> [--root ~/ServerRoot] [--dry-run]

Full-scans every git clone under --root (depth 1, and depth 2 inside folders that are not clones; worktrees, node_modules and folders named *archive* skipped), one scan per remote, and submits each comparable run to the leaderboard with --email and the repo hash only (no repo name). --dry-run scans and submits nothing.`;

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string', default: process.env.VCS_SUBMIT_EMAIL },
      root: { type: 'string', default: path.join(homedir(), 'ServerRoot') },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const email = values.email;
  const dryRun = values['dry-run'];
  if (!dryRun && (!email || !EMAIL_PATTERN.test(email))) {
    log(`--email (or VCS_SUBMIT_EMAIL) is required to submit.\n\n${USAGE}`);
    return 1;
  }

  const methodology = loadMethodology(CURRENT_METHODOLOGY_VERSION);
  const asOf = new Date().toISOString().slice(0, 10);
  const repos = findRepos(path.resolve(values.root));
  log(`${repos.length} repos under ${values.root}`);

  const seen = new Set<string>();
  let submitted = 0;
  let failed = 0;
  for (const repoPath of repos) {
    const label = path.relative(values.root, repoPath);
    let hash: string;
    try {
      hash = (await repoIdentity(repoPath, defaultGit)).hash;
    } catch {
      log(`skip ${label}: no repository identity`);
      continue;
    }
    if (seen.has(hash)) {
      log(`skip ${label}: same remote as a repo already scanned`);
      continue;
    }
    seen.add(hash);

    log(`scan ${label}`);
    let run;
    try {
      run = await runScan({ repoPath, methodologyVersion: CURRENT_METHODOLOGY_VERSION, mode: 'full', asOf }, methodology);
    } catch (error) {
      if (error instanceof NoLogicFilesError) log(`skip ${label}: no logic files`);
      else {
        failed++;
        log(`fail ${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    const health = run.health ? Math.round(run.health.displayed) : null;
    if (!run.valid) {
      failed++;
      log(`fail ${label}: run invalid (${run.invalidReason ?? 'no reason'})`);
      continue;
    }
    if (!run.comparable) {
      log(`skip ${label}: health ${health}, not comparable (${run.comparableReason ?? 'no reason'})`);
      continue;
    }
    if (dryRun || !email) {
      log(`ok   ${label}: health ${health} (dry run, not submitted)`);
      continue;
    }
    try {
      const payload = buildPayload({ run, repoHash: hash, email });
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('payload larger than 64 KB');
      const result = await sendPayload(payload, fetch as unknown as FetchLike);
      if (!result.ok) throw new Error(result.message);
      submitted++;
      log(`sent ${label}: health ${health}${result.rank ? `, rank ${result.rank.rank} of ${result.rank.total}` : ''}`);
    } catch (error) {
      failed++;
      log(`fail ${label}: submit (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  log(`${submitted} submitted, ${failed} failed, ${seen.size} distinct repos${dryRun ? ' (dry run)' : ''}`);
  return failed > 0 ? 3 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    log(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
