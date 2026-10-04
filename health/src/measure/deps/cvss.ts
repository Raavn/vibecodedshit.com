/** CVSS v3.0 and v3.1 base score from a vector string. Other versions give undefined. */

const WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

function pr(value: string, changed: boolean): number | undefined {
  if (value === 'N') return 0.85;
  if (value === 'L') return changed ? 0.68 : 0.62;
  if (value === 'H') return changed ? 0.5 : 0.27;
  return undefined;
}

/** Smallest number, to one decimal, that is >= the input (CVSS v3.1 Roundup). */
export function roundUp(input: number): number {
  const int = Math.round(input * 100000);
  if (int % 10000 === 0) return int / 100000;
  return (Math.floor(int / 10000) + 1) / 10;
}

export function cvss3BaseScore(vector: string): number | undefined {
  const parts = vector.trim().split('/');
  if (parts[0] !== 'CVSS:3.0' && parts[0] !== 'CVSS:3.1') return undefined;
  const metrics = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const [key, value] = part.split(':');
    if (key && value) metrics.set(key, value);
  }
  const get = (key: string): string => metrics.get(key) ?? '';
  const scope = get('S');
  if (scope !== 'U' && scope !== 'C') return undefined;
  const changed = scope === 'C';
  const av = WEIGHTS.AV[get('AV') as keyof typeof WEIGHTS.AV];
  const ac = WEIGHTS.AC[get('AC') as keyof typeof WEIGHTS.AC];
  const ui = WEIGHTS.UI[get('UI') as keyof typeof WEIGHTS.UI];
  const c = WEIGHTS.CIA[get('C') as keyof typeof WEIGHTS.CIA];
  const i = WEIGHTS.CIA[get('I') as keyof typeof WEIGHTS.CIA];
  const a = WEIGHTS.CIA[get('A') as keyof typeof WEIGHTS.CIA];
  const priv = pr(get('PR'), changed);
  if ([av, ac, ui, c, i, a, priv].some((n) => n === undefined)) return undefined;
  const iss = 1 - (1 - (c ?? 0)) * (1 - (i ?? 0)) * (1 - (a ?? 0));
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * (av ?? 0) * (ac ?? 0) * (priv ?? 0) * (ui ?? 0);
  const raw = changed ? Math.min(1.08 * (impact + exploitability), 10) : Math.min(impact + exploitability, 10);
  return roundUp(raw);
}

export type SeverityBand = 'critical' | 'high' | 'moderate' | 'low' | 'none';

export function band(score: number): SeverityBand {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'moderate';
  if (score > 0) return 'low';
  return 'none';
}
