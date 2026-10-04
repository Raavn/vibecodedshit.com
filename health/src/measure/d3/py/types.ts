import type { Preset } from '../../../methodology/schema.js';
import type { ScopedFile } from '../../../scope/types.js';
import type { D3Rules } from '../types.js';
import type { PyDeclared } from './config.js';
import type { PyRoot } from './roots.js';

export interface PyUnit {
  package: string;
  files: ScopedFile[];
  logic: ScopedFile[];
  weight: number;
  preset: Preset;
  declared: PyDeclared | undefined;
  roots: PyRoot[];
  rules: D3Rules;
}

export interface PySetup {
  units: PyUnit[];
  warnings: string[];
}
