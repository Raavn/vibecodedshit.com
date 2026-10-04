import type { PresetKey } from '../../methodology/schema.js';
import type { Group } from '../../scope/types.js';
import type { MeasureContext } from '../types.js';

export interface D3Rules {
  package: string;
  group: Group;
  /** Logic lines of the unit. */
  weight: number;
  preset: PresetKey;
  rulesSource: 'declared' | 'preset';
  rulesFile?: string;
  level31: 'none' | 'declared' | 'enforced';
}

/** Repo-relative posix paths, both in scope, from != to. */
export interface D3Edge {
  from: string;
  to: string;
  fromTest: boolean;
  runtime: boolean;
}

export interface D3Graph extends D3Rules {
  logicFiles: string[];
  /** Importer belongs to this unit; target is any in-scope file. */
  edges: D3Edge[];
  /** `${from}\u0000${to}` per violating edge, deduplicated; the target may be a package name. */
  violating: string[];
  /** Rule names that flagged each violating edge, same keys as `violating`. */
  violationRules: Record<string, string[]>;
  moduleCount: number;
  /** Empty when `moduleCount` < 2. */
  crossings: { from: string; to: string; toEntry: boolean }[];
  domain: { files: string[]; impure: string[] };
}

export interface D3RulesResult {
  units: D3Rules[];
  warnings: string[];
}

export type D3GraphResult = { units: D3Graph[]; warnings: string[] } | { unavailable: string };

export interface D3Adapter {
  group: Group;
  /** Needs no external tool. */
  rules(ctx: MeasureContext): Promise<D3RulesResult>;
  /** Needs the adapter's tool. */
  graph(ctx: MeasureContext): Promise<D3GraphResult>;
}

export const edgeKey = (from: string, to: string): string => `${from}\u0000${to}`;

/** Edges of the unit that count for 3.2: importer is not a test file. */
export function internalEdges(unit: D3Graph): D3Edge[] {
  return unit.edges.filter((edge) => !edge.fromTest);
}
