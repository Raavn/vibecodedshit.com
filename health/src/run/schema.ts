import type { Raw } from '../measure/types.js';
import type { Group } from '../scope/types.js';

export type ParameterStatus = 'measured' | 'not_applicable' | 'not_measured' | 'failed';

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
  tools: { health: string; node: string; typescript: string; git: string; python?: string };
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
