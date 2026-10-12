import type { Raw } from '../measure/types.js';
import type { Methodology } from '../methodology/load.js';
import type { RunFile, RunParameter } from '../run/schema.js';

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** Whole numbers print bare (0 findings, 178 points), anything else with one decimal (3.1 seconds). */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : round1(value);
}

/** One raw value as text: scale-100 ratios in %, scale-1000 ratios and numbers with the YAML unit. Null when it has no value. */
export function formatRaw(raw: Raw, unit: string): string | null {
  switch (raw.kind) {
    case 'ratio': {
      if (raw.denominator === 0) return null;
      const value = round1((raw.numerator / raw.denominator) * raw.scale);
      return raw.scale === 100 ? `${value}%` : `${value} ${unit}`;
    }
    case 'number':
      return unit === 'count' ? formatNumber(raw.value) : `${formatNumber(raw.value)} ${unit}`;
    case 'level':
      return raw.level;
    case 'components':
      return Object.entries(raw.components)
        .map(([name, component]) => `${name}=${formatRaw(component, unit) ?? 'n/a'}`)
        .join(', ');
  }
}

/**
 * The raw value printed for a measured parameter: the pooled value when there is one, otherwise the unit values
 * (one unit alone, several as `package/group: value` joined with `; `). Levels list the distinct levels, as before.
 */
export function shownRaw(param: RunParameter, unit: string): string {
  if (param.raw) {
    const pooled = formatRaw(param.raw, unit);
    if (pooled !== null) return pooled;
  }
  const units = param.units ?? [];
  if (units.length > 0 && units.every((u) => u.raw.kind === 'level')) {
    return [...new Set(units.map((u) => (u.raw as { level: string }).level))].join(', ');
  }
  const shown = units.flatMap((u) => {
    const value = formatRaw(u.raw, unit);
    return value === null ? [] : [{ label: `${u.package}/${u.group}`, value }];
  });
  if (shown.length === 0) return 'n/a';
  if (shown.length === 1) return shown[0]?.value ?? 'n/a';
  return shown.map((s) => `${s.label}: ${s.value}`).join('; ');
}

export function summarize(run: RunFile, methodology: Methodology): string {
  const lines: string[] = [];
  if (run.health) {
    const band = methodology.bands.find((b) => b.key === run.health?.band);
    lines.push(`Health ${run.health.displayed} ${band?.name ?? run.health.band} (${run.mode === 'preview' ? 'preview, ' : ''}${run.comparable ? 'comparable' : 'not comparable'})`);
  }
  for (const dimension of run.dimensions) {
    if (dimension.score === null) continue;
    const def = methodology.dimensions.find((d) => d.id === dimension.id);
    lines.push(`Dimension ${dimension.id} ${def?.name ?? dimension.key}: ${Math.floor(dimension.score + 0.5 + 1e-9)}`);
  }
  const defs = new Map(methodology.dimensions.flatMap((d) => d.parameters).map((p) => [p.id, p]));
  for (const param of run.parameters) {
    const def = defs.get(param.id);
    if (param.status === 'not_measured' && param.reason && !/^(execution layer|not implemented)/.test(param.reason)) {
      lines.push(`${param.id} ${def?.name ?? ''}: not measured (${param.reason})`);
      continue;
    }
    if (param.status !== 'measured') continue;
    lines.push(`${param.id} ${def?.name ?? ''}: ${shownRaw(param, def?.raw.unit ?? '')} -> ${Math.floor((param.score ?? 0) + 0.5 + 1e-9)}`);
  }
  return `${lines.join('\n')}\n`;
}
