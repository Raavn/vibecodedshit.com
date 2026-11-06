import type { Methodology } from '../methodology/load.js';
import type { BandDef } from '../methodology/schema.js';
import type { RunFile } from '../run/schema.js';
import { roundHalfUp } from '../scoring/aggregate.js';
import { healthWith, nextCandidate, type ScoreOverrides } from '../scoring/what-if.js';
import { precedenceRank } from './order.js';

export const PREVIEW_LINE = 'Install Docker for a full run to get your Route';

export interface RouteStep {
  id: string;
  name: string;
  dimensionId: number;
  fromScore: number;
  toScore: number;
  /** The descriptor of the anchor or level the Step reaches, quoted from the YAML. */
  descriptor: string;
}

export interface RouteSlice extends RouteStep {
  /** 1-based position in the written order. */
  position: number;
  healthBefore: number;
  healthAfter: number;
}

export type RoutePlan =
  | { kind: 'preview' }
  | { kind: 'none' }
  | {
      kind: 'route';
      target: BandDef;
      /** Displayed health before the first Slice and after the last. */
      from: number;
      to: number;
      reached: boolean;
      /** Parameters a non-comparable full run did not measure, which the Route leaves out. */
      unmeasured: string[];
      slices: RouteSlice[];
    };

/** Vibe-coded and Fragile aim at Stable, Stable at Agent-ready, Agent-ready at nothing. The bounds come from the YAML. */
export function targetBand(current: string, methodology: Methodology): BandDef | null {
  const bands = [...methodology.bands].sort((a, b) => a.min - b.min);
  const stable = bands.findIndex((b) => b.key === 'stable');
  const at = bands.findIndex((b) => b.key === current);
  if (stable < 0 || at < 0 || at > stable) return null;
  return at < stable ? (bands[stable] ?? null) : (bands[stable + 1] ?? null);
}

function currentScore(run: RunFile, id: string, overrides: ScoreOverrides): number | null {
  const override = overrides.get(id);
  if (override !== undefined) return override;
  const param = run.parameters.find((p) => p.id === id);
  if (param?.status === 'failed') return 0;
  if (param?.status === 'measured') return param.score ?? 0;
  return null;
}

/** The greedy Steps: each is the one that raises the displayed health most, until the Target band is reached or no Step adds health. */
function selectSteps(run: RunFile, methodology: Methodology, target: BandDef): { steps: RouteStep[]; reached: boolean } {
  const overrides = new Map<string, number>();
  const steps: RouteStep[] = [];
  for (;;) {
    const base = healthWith(run, methodology, overrides);
    if (base.health === null) return { steps, reached: false };
    const displayed = roundHalfUp(base.health);
    if (displayed >= target.min) return { steps, reached: true };
    let best: { step: RouteStep; rise: number; precise: number; dimensionScore: number } | null = null;
    for (const dim of methodology.dimensions) {
      for (const def of dim.parameters) {
        const score = currentScore(run, def.id, overrides);
        if (score === null) continue;
        const candidate = nextCandidate(def, score);
        if (!candidate) continue;
        const after = healthWith(run, methodology, new Map([...overrides, [def.id, candidate.score]])).health;
        if (after === null || after - base.health <= 1e-9) continue;
        const entry = {
          step: { id: def.id, name: def.name, dimensionId: dim.id, fromScore: score, toScore: candidate.score, descriptor: candidate.descriptor },
          rise: roundHalfUp(after) - displayed,
          precise: after - base.health,
          dimensionScore: base.dimension.get(dim.id) ?? 0,
        };
        if (
          !best ||
          entry.rise > best.rise ||
          (entry.rise === best.rise &&
            (entry.precise > best.precise + 1e-9 ||
              (Math.abs(entry.precise - best.precise) <= 1e-9 &&
                (entry.dimensionScore < best.dimensionScore || (entry.dimensionScore === best.dimensionScore && entry.step.id.localeCompare(best.step.id, 'en', { numeric: true }) < 0)))))
        ) {
          best = entry;
        }
      }
    }
    if (!best) return { steps, reached: false };
    overrides.set(best.step.id, best.step.toScore);
    steps.push(best.step);
  }
}

/** The Route for a run: Steps chosen by Gain, then written as Slices in the fixed precedence with the health after each. */
export function buildRoute(run: RunFile, methodology: Methodology): RoutePlan {
  if (!run.health) return { kind: 'none' };
  const target = targetBand(run.health.band, methodology);
  if (!target) return { kind: 'none' };
  if (run.mode === 'preview') return { kind: 'preview' };
  const { steps, reached } = selectSteps(run, methodology, target);
  const ordered = [...steps].sort((a, b) => precedenceRank(a.id) - precedenceRank(b.id) || a.toScore - b.toScore);
  const overrides = new Map<string, number>();
  let before = run.health.displayed;
  const slices = ordered.map((step, i): RouteSlice => {
    overrides.set(step.id, step.toScore);
    const after = roundHalfUp(healthWith(run, methodology, overrides).health ?? before);
    const slice = { ...step, position: i + 1, healthBefore: before, healthAfter: after };
    before = after;
    return slice;
  });
  return {
    kind: 'route',
    target,
    from: run.health.displayed,
    to: before,
    reached,
    unmeasured: run.parameters.filter((p) => p.status === 'not_measured').map((p) => p.id),
    slices,
  };
}

/** The stdout lines: the summary, plus the out-of-reach line when the Target band is not reached. A preview gets its one line, Agent-ready nothing. */
export function routeLines(plan: RoutePlan): string[] {
  if (plan.kind === 'preview') return [PREVIEW_LINE];
  if (plan.kind === 'none') return [];
  const lines = [`Route to ${plan.target.name}: ${plan.slices.length} Slices, ${plan.from} -> ${plan.to}`];
  if (!plan.reached) lines.push(outOfReachLine(plan));
  return lines;
}

export function outOfReachLine(plan: Extract<RoutePlan, { kind: 'route' }>): string {
  const reason = plan.unmeasured.length > 0 ? `until ${plan.unmeasured.join(', ')} are measured` : 'with the parameters measured, because no further Step adds health';
  return `${plan.target.name} is out of reach ${reason}; this Route gets you to ${plan.to}`;
}
