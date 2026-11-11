import { parseArgs } from 'node:util';
import { DEFAULT_API_BASE, loadToken, postLead, type LeadPayload } from './api.js';
import { hasCustomDomain, hasPaymentsOrAuth, MIN_COMMITS, pushedRecently, MAX_PUSH_AGE_DAYS } from './filter.js';
import { runSummary, topFinding } from './finding.js';
import { DEFAULT_SIGNALS, discover, ghApi, hasMoreCommits, ownerContact, readRepoFiles, type Candidate, type Signal } from './github.js';
import { scanRepo } from './scan.js';

const USAGE = `Usage: npm --prefix outbound run find -- [--limit 10] [--signals lovable,v0,bolt] [--max-scans 60] [--dry-run]

Finds public AI-built GitHub repos with a live product and a serious finding, scans them (static layer, in the health:1.0 image) and POSTs each lead to the app. Nothing is sent to anyone. Needs gh logged in, Docker with health:1.0 built, and AIMEKO_TOKEN (env or ~/ServerRoot/.env.agents). LEADS_API_BASE overrides ${DEFAULT_API_BASE}.`;

const SIGNALS: Record<string, Signal> = { lovable: 'LOVABLE', v0: 'V0', bolt: 'BOLT', replit: 'REPLIT' };

interface Lead {
  candidate: Candidate;
  payload: LeadPayload;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function qualify(candidate: Candidate, now: Date): Promise<string | null> {
  if (!hasCustomDomain(candidate.homepage)) return 'no custom-domain homepage';
  if (!pushedRecently(candidate.pushedAt, now)) return `not pushed in ${MAX_PUSH_AGE_DAYS} days`;
  if (!(await hasMoreCommits(ghApi, candidate.fullName, MIN_COMMITS))) return `${MIN_COMMITS} commits or fewer`;
  const files = await readRepoFiles(ghApi, candidate.fullName);
  if (!files) return 'file tree unreadable';
  if (!hasPaymentsOrAuth(files.packageJsons, files.paths)) return 'no payments or auth signs';
  return null;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string', default: '10' },
      signals: { type: 'string', default: DEFAULT_SIGNALS.map((s) => s.toLowerCase()).join(',') },
      'max-scans': { type: 'string', default: '60' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const limit = Number(values.limit);
  const maxScans = Number(values['max-scans']);
  const signals = (values.signals ?? '').split(',').map((s) => SIGNALS[s.trim().toLowerCase()]);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(maxScans) || maxScans < 1 || signals.some((s) => s === undefined)) {
    log(USAGE);
    return 1;
  }

  const token = loadToken();
  if (!token && !values['dry-run']) {
    log('AIMEKO_TOKEN is not set (env or ~/ServerRoot/.env.agents). Use --dry-run to scan without posting.');
    return 2;
  }
  const base = process.env.LEADS_API_BASE ?? DEFAULT_API_BASE;

  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - MAX_PUSH_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const candidates = await discover(ghApi, signals as Signal[], since, 50);
  log(`${candidates.length} candidates from ${signals.join(', ')}`);

  const leads: Lead[] = [];
  let scans = 0;
  for (const candidate of candidates) {
    if (leads.length >= limit || scans >= maxScans) break;
    const reason = await qualify(candidate, now);
    if (reason) {
      log(`skip ${candidate.fullName}: ${reason}`);
      continue;
    }
    scans++;
    try {
      const run = await scanRepo(candidate.fullName, asOf);
      const finding = topFinding(run);
      if (!finding || !run.health || !candidate.homepage) {
        log(`skip ${candidate.fullName}: no ranking finding`);
        continue;
      }
      const contact = await ownerContact(ghApi, candidate.owner);
      leads.push({
        candidate,
        payload: {
          repoFullName: candidate.fullName,
          repoUrl: candidate.url,
          homepage: /^https?:\/\//i.test(candidate.homepage) ? candidate.homepage : `https://${candidate.homepage}`,
          owner: candidate.owner,
          signal: candidate.signal,
          lastPushAt: candidate.pushedAt,
          health: Math.round(run.health.displayed),
          band: run.health.band,
          ...finding,
          ...contact,
          run: runSummary(run, candidate.signal),
        },
      });
      log(`lead ${candidate.fullName}: rank ${finding.severityRank}`);
    } catch (error) {
      log(`skip ${candidate.fullName}: scan failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  leads.sort((a, b) => a.payload.severityRank - b.payload.severityRank || b.payload.lastPushAt.localeCompare(a.payload.lastPushAt));

  let failures = 0;
  for (const { payload } of leads) {
    if (values['dry-run'] || !token) continue;
    try {
      await postLead(payload, token, base);
    } catch (error) {
      failures++;
      log(`post failed for ${payload.repoFullName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const [i, { payload }] of leads.entries()) {
    const where = payload.findingFile ? `${payload.findingFile}${payload.findingLine ? `:${payload.findingLine}` : ''}` : (payload.findingDetail ?? payload.findingParam);
    console.log(`${i + 1}. ${payload.repoFullName}  ${payload.homepage}  [${payload.findingParam}] ${where}`);
  }
  log(`${leads.length} qualifying leads of ${scans} scans${values['dry-run'] ? ' (dry run, nothing posted)' : ''}${leads.length < limit ? `, fewer than the ${limit} asked for` : ''}`);
  return failures > 0 ? 3 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    log(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
