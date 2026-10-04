import type { ExecutionResults } from '../exec/types.js';
import type { Methodology } from '../methodology/load.js';
import type { ParameterDef } from '../methodology/schema.js';
import type { Scope, Group } from '../scope/types.js';
import type { ToolKit } from '../tools/kit.js';

export type Raw =
  | { kind: 'ratio'; numerator: number; denominator: number; scale: number; emptyScore?: number }
  | { kind: 'level'; level: string }
  | { kind: 'number'; value: number }
  | { kind: 'components'; components: Record<string, Raw> };

export interface UnitRaw {
  package: string;
  group: Group;
  /** Logic lines of this unit. */
  weight: number;
  raw: Raw;
}

export type Measurement =
  | {
      status: 'measured';
      units: UnitRaw[];
      /** Copied into run.json top-level `reportOnly`, one key per entry. Never scored. */
      reportOnly?: Record<string, unknown>;
      /** Appended to run.json `warnings`. */
      warnings?: string[];
    }
  | { status: 'not_measured'; reason: string }
  | { status: 'not_applicable'; reason: string }
  | { status: 'failed'; reason: string };

export interface MeasureContext {
  methodology: Methodology;
  param: ParameterDef;
  scope: Scope;
  repoPath: string;
  asOf: string;
  mode: 'preview' | 'full';
  tools: ToolKit;
  /** Results of the execution layer, set in full mode only. Execution measurers are pure functions of this. */
  exec?: ExecutionResults;
}

export interface Measurer {
  id: string;
  layer: 'static' | 'execution';
  measure(ctx: MeasureContext): Promise<Measurement>;
}
