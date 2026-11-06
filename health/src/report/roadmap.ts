import type { Methodology } from '../methodology/load.js';
import type { ParameterDef } from '../methodology/schema.js';
import type { RunFile } from '../run/schema.js';
import { roundHalfUp } from '../scoring/aggregate.js';
import { healthWith, nextCandidate } from '../scoring/what-if.js';
import { rawText } from './format.js';

export const ROADMAP_LIMIT = 10;
const STDOUT_LIMIT = 3;
const NO_OVERRIDES = new Map<string, number>();

export interface RoadmapItem {
  id: string;
  name: string;
  dimensionId: number;
  dimensionName: string;
  /** The raw value as the report prints it. Null for a failed parameter, which has none. */
  raw: string | null;
  score: number;
  /** Whole health points the displayed health would rise by if this parameter alone reached 100. */
  gain: number;
  gainPrecise: number;
  /** The descriptor of the next anchor or level above the current score, quoted from the YAML. */
  target: string | null;
}

/** The descriptor of the lowest-scoring anchor or level above `score`. Null when there is none or the parameter has no descriptors. */
export function targetDescriptor(def: ParameterDef, score: number): string | null {
  return nextCandidate(def, score)?.descriptor ?? null;
}

/**
 * The parameters ranked by Gain: the whole health points the displayed health would rise by if that one parameter
 * alone reached 100. Parameters at 100 and the not applicable or not measured ones are not listed. Empty when the
 * run has no health score. Items with no Gain are listed only to fill the list up to the limit.
 */
export function buildRoadmap(run: RunFile, methodology: Methodology): RoadmapItem[] {
  if (!run.health) return [];
  const base = healthWith(run, methodology, NO_OVERRIDES);
  if (base.health === null) return [];
  const items: RoadmapItem[] = [];
  const dimensionOf = new Map<string, number>();
  for (const dim of methodology.dimensions) {
    for (const def of dim.parameters) {
      const param = run.parameters.find((p) => p.id === def.id);
      if (!param || (param.status !== 'measured' && param.status !== 'failed')) continue;
      const score = param.status === 'failed' ? 0 : (param.score ?? 0);
      if (score >= 100) continue;
      const after = healthWith(run, methodology, new Map([[def.id, 100]])).health ?? base.health;
      items.push({
        id: def.id,
        name: def.name,
        dimensionId: dim.id,
        dimensionName: dim.name,
        raw: param.status === 'measured' ? rawText(param, def) : null,
        score,
        gain: roundHalfUp(after) - run.health.displayed,
        gainPrecise: after - base.health,
        target: targetDescriptor(def, score),
      });
      dimensionOf.set(def.id, base.dimension.get(dim.id) ?? 0);
    }
  }
  items.sort((a, b) => b.gain - a.gain || b.gainPrecise - a.gainPrecise || (dimensionOf.get(a.id) ?? 0) - (dimensionOf.get(b.id) ?? 0) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  return items.slice(0, ROADMAP_LIMIT);
}

export function gainText(gain: number): string {
  return gain > 0 ? `+${gain}` : '+0 · no gain';
}

/** The top lines `health report` prints after the report path: `<rank>. <id> <name> (<dimension>) +<gain> — <target>`. */
export function roadmapLines(run: RunFile, methodology: Methodology): string[] {
  return buildRoadmap(run, methodology)
    .slice(0, STDOUT_LIMIT)
    .map((item, i) => `${i + 1}. ${item.id} ${item.name} (${item.dimensionName}) ${gainText(item.gain)}${item.target ? ` — ${item.target}` : ''}`);
}
