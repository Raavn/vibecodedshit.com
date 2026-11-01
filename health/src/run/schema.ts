import type { Raw } from '../measure/types.js';
import type { Group } from '../scope/types.js';

type ParameterStatus = 'measured' | 'not_applicable' | 'not_measured' | 'failed';

export interface RunUnit {
  package: string;
  group: Group;
  weight: number;
  raw: Raw;
  score: number;
}

export interface RunParameter {
  id: string;
  status: ParameterStatus;
  reason?: string;
  weight: number;
  raw?: Raw | null;
  score?: number;
  units?: RunUnit[];
}

export interface RunDimension {
  id: number;
  key: string;
  score: number | null;
}

export interface FeedbackLoop {
  typecheckSeconds: number;
  lintSeconds: number;
  testSeconds: number;
  totalSeconds: number;
}

export interface RunFile {
  schemaVersion: 1;
  valid: boolean;
  invalidReason?: string;
  warnings: string[];
  methodology: { version: string };
  mode: 'preview' | 'full';
  comparable: boolean;
  comparableReason?: string;
  asOf: string;
  layers: ('static' | 'execution')[];
  repo: { path: string; headCommit: string | null; treeHash: string | null };
  tools: {
    health: string;
    node: string;
    typescript: string;
    git: string;
    python?: string;
    /** Full runs: the execution image and its digest (`docker image inspect --format '{{.Id}}'`). */
    image?: { tag: string; digest: string };
    /** Static tools that ran (name to version). */
    static?: Record<string, string>;
  };
  /** Full runs: wall-clock seconds of the typecheck, lint and test steps, whose sum is 6.3's raw value. Additive, ignored by recompute and diff. */
  execution?: { feedbackLoop: FeedbackLoop };
  /** Report-only values, never scored and ignored by recompute. */
  reportOnly?: Record<string, unknown>;
  ignoreSet: {
    healthignoreSha256: string | null;
    gitleaksignoreSha256: string | null;
    excludedLinesPercent: number;
  };
  scope: { logicFiles: number; logicLines: number; sourceLines: number; packages: string[] };
  parameters: RunParameter[];
  dimensions: RunDimension[];
  breakdown: {
    byPackage: Record<string, Record<string, number | null>>;
    byGroup: Record<string, Record<string, number | null>>;
  };
  health: { score: number; displayed: number; band: string } | null;
}
