import { parseJestJson } from './jest-json.js';
/** vitest's json reporter is jest-compatible; `test.fails` cases appear as passed. */
export function parseVitestJson(text) {
    return parseJestJson(text);
}
