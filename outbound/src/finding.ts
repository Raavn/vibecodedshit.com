import { buildScares } from '../../health/src/report/scares.js';
import type { RunFile } from '../../health/src/run/schema.js';

/** 1 is the most severe. Matches the app's `severityRank` (ordered ascending). */
export type SeverityRank = 1 | 2 | 3 | 4;

export interface Finding {
  severityRank: SeverityRank;
  findingParam: string;
  findingFile: string | null;
  findingLine: number | null;
  findingDetail: string | null;
  riskSentence: string;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, moderate: 2, low: 1 };

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null) : [];

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null);

/**
 * The scare that would have been shown for each business finding, in `buildScares` order. The scare text is the
 * risk sentence. `buildScares` caps its list, so a finding that fell past the cap never ranks a lead on its own.
 */
const SERVICE_ROLE = /read and change all the data in your Supabase/;
const COMMITTED_SECRET = /use a secret committed in/;
const DEPENDENCY = /publicly known security holes/;
const HISTORY = /still readable in your git history/;

/**
 * The top business finding of a scan, or null when no ranking finding fires. Only committed secrets (5.4) and known
 * advisories in production dependencies (5.1) count; the other scares are not business findings. File and line come
 * from the structured run values, never from the scare text. The secret itself is never read: p5-4 does not keep it.
 */
export function topFinding(run: RunFile): Finding | null {
  const scares = buildScares(run);
  const only = run.reportOnly ?? {};

  const tree = records(only.secretsInTree);
  const scare = (re: RegExp): string | undefined => scares.find((s) => re.test(s));

  const serviceRoleScare = scare(SERVICE_ROLE);
  if (serviceRoleScare) {
    const hit = tree.find((f) => f.supabaseRole === 'service_role');
    return {
      severityRank: 1,
      findingParam: '5.4',
      findingFile: str(hit?.file),
      findingLine: num(hit?.line),
      findingDetail: 'Supabase service_role key committed',
      riskSentence: serviceRoleScare,
    };
  }

  const secretScare = scare(COMMITTED_SECRET);
  if (secretScare) {
    const hit = tree.find((f) => f.supabaseRole !== 'service_role' && f.supabaseRole !== 'anon');
    return {
      severityRank: 2,
      findingParam: '5.4',
      findingFile: str(hit?.file),
      findingLine: num(hit?.line),
      findingDetail: str(hit?.ruleId) === null ? 'Secret committed' : `Secret committed (${str(hit?.ruleId)})`,
      riskSentence: secretScare,
    };
  }

  const dependencyScare = scare(DEPENDENCY);
  if (dependencyScare) {
    const advisories = records((only.productionDependencyVulnerabilities as { advisories?: unknown } | undefined)?.advisories);
    const worst = [...advisories].sort((a, b) => (SEVERITY_ORDER[str(b.severity) ?? ''] ?? 0) - (SEVERITY_ORDER[str(a.severity) ?? ''] ?? 0))[0];
    const name = str(worst?.name);
    const version = str(worst?.version);
    return {
      severityRank: 3,
      findingParam: '5.1',
      findingFile: null,
      findingLine: null,
      findingDetail: name === null ? 'Production dependency advisories' : `${name}${version === null ? '' : ` ${version}`}`,
      riskSentence: dependencyScare,
    };
  }

  const historyScare = scare(HISTORY);
  if (historyScare) {
    const inTree = new Set(tree.map((f) => `${str(f.file)}\0${str(f.ruleId)}`));
    const history = records((only.secretsInHistory as { findings?: unknown } | undefined)?.findings);
    const gone = history.find((f) => !inTree.has(`${str(f.file)}\0${str(f.ruleId)}`));
    return {
      severityRank: 4,
      findingParam: '5.4',
      findingFile: str(gone?.file),
      findingLine: num(gone?.line),
      findingDetail: 'Secret removed from the code but still in git history',
      riskSentence: historyScare,
    };
  }

  return null;
}

/** What the lead row stores of a run (step 6 aggregate): scores and statuses only, no paths, no repo name. */
export function runSummary(run: RunFile, signal: string): Record<string, unknown> {
  return {
    signal,
    methodology: run.methodology.version,
    mode: run.mode,
    asOf: run.asOf,
    health: run.health,
    dimensions: run.dimensions,
    parameters: run.parameters.map((p) => ({
      id: p.id,
      status: p.status,
      weight: p.weight,
      ...(p.score === undefined ? {} : { score: p.score }),
    })),
  };
}
