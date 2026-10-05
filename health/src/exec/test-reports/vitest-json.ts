import type { CaseCounts } from '../types.js';
import { parseJestJson } from './jest-json.js';

/** vitest's json reporter is jest-compatible; `test.fails` cases appear as passed. */
export function parseVitestJson(text: string): CaseCounts | null {
  return parseJestJson(text);
}
