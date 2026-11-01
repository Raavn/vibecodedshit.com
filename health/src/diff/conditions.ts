import type { RunFile } from '../run/schema.js';

type ConditionKey = 'layers' | 'tool_versions' | 'methodology_version' | 'as_of_date' | 'ignore_set' | 'run_not_comparable';

export interface Refusal {
  condition: ConditionKey;
  message: string;
}

const NONE = '(none)';

/** Layers as written, for the message. */
function layerText(run: RunFile): string {
  return [...new Set(run.layers)].join('+') || NONE;
}

/** Layers as a set, for the comparison. */
function layerKey(run: RunFile): string {
  return [...new Set(run.layers)].sort().join('+');
}

/** Flatten nested objects to dotted keys, so a differing leaf is named exactly. */
function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) flatten(inner, `${prefix}.${key}`, out);
    return;
  }
  out.set(prefix, JSON.stringify(value));
}

function shown(json: string | undefined): string {
  if (json === undefined) return NONE;
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'string' ? value : json;
  } catch {
    return json;
  }
}

function toolDifferences(a: RunFile, b: RunFile): string[] {
  const left = new Map<string, string>();
  const right = new Map<string, string>();
  flatten(a.tools, 'tools', left);
  flatten(b.tools, 'tools', right);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return keys.filter((k) => left.get(k) !== right.get(k)).map((k) => `${k} a=${shown(left.get(k))} b=${shown(right.get(k))}`);
}

function ignoreDifferences(a: RunFile, b: RunFile): string[] {
  const out: string[] = [];
  if (a.ignoreSet.healthignoreSha256 !== b.ignoreSet.healthignoreSha256) out.push('.healthignore hash');
  if (a.ignoreSet.gitleaksignoreSha256 !== b.ignoreSet.gitleaksignoreSha256) out.push('.gitleaksignore hash');
  return out;
}

/** The five `delta.conditions` of methodology.yaml, in order. Every mismatch is reported. */
export function conditionRefusals(a: RunFile, b: RunFile): Refusal[] {
  const refusals: Refusal[] = [];
  if (layerKey(a) !== layerKey(b)) {
    refusals.push({ condition: 'layers', message: `layers differ (a: ${layerText(a)}, b: ${layerText(b)})` });
  }
  const tools = toolDifferences(a, b);
  if (tools.length > 0) refusals.push({ condition: 'tool_versions', message: `tool versions differ: ${tools.join(', ')}` });
  if (a.methodology.version !== b.methodology.version) {
    refusals.push({
      condition: 'methodology_version',
      message: `methodology version differs (a: ${a.methodology.version}, b: ${b.methodology.version}); runs from different versions are never compared`,
    });
  }
  if (a.asOf !== b.asOf) {
    refusals.push({ condition: 'as_of_date', message: `as-of date differs (a: ${a.asOf}, b: ${b.asOf})` });
  }
  const ignore = ignoreDifferences(a, b);
  if (ignore.length > 0) refusals.push({ condition: 'ignore_set', message: `ignore set differs: ${ignore.join(', ')}` });
  return refusals;
}

/** A run that cannot be compared at all: invalid, preview or without a health score. */
export function notComparableRefusals(before: RunFile, after: RunFile): Refusal[] {
  const refusals: Refusal[] = [];
  for (const [side, run] of [
    ['before', before],
    ['after', after],
  ] as const) {
    let reason: string | null = null;
    if (!run.valid) reason = run.invalidReason ?? 'run is invalid';
    else if (!run.comparable) reason = run.comparableReason ?? 'run is not comparable';
    else if (run.health === null) reason = 'run has no health score';
    if (reason !== null) refusals.push({ condition: 'run_not_comparable', message: `${side} run is not comparable: ${reason}` });
  }
  return refusals;
}
