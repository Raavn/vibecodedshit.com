import type { CaseCounts } from '../types.js';

/**
 * JUnit XML from pytest and `node --test`. Every `<testcase>` is one case: `<error>` is errored
 * (a pytest collection error is a testcase with an error), `<failure>` is failed, `<skipped>` is
 * skipped except pytest's `xfail`, which is left out entirely. Null when there is no testsuite.
 */
export function parseJunit(text: string): CaseCounts | null {
  if (!/<testsuites?\b/.test(text)) return null;
  const counts: CaseCounts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const match of text.matchAll(/<testcase\b[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = match[1] ?? '';
    if (/<error\b/.test(body)) counts.errored += 1;
    else if (/<failure\b/.test(body)) counts.failed += 1;
    else if (/<skipped\b/.test(body)) {
      if (!/<skipped\b[^>]*type="pytest\.xfail"/.test(body)) counts.skipped += 1;
    } else counts.passed += 1;
  }
  return counts;
}
