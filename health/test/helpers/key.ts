import type { KeyCheckResult } from '../../src/key/check.js';

/** A key-check seam for tests that exercise `run()`: always valid, never touches the network or a real key. */
export const validKeyCheck = (): Promise<KeyCheckResult> => Promise.resolve({ ok: true });
