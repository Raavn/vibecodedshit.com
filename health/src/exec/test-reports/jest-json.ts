import type { CaseCounts } from '../types.js';

interface JestFile {
  status?: string;
  assertionResults?: { status?: string }[];
}

/**
 * `jest --json` and `vitest --reporter=json` share one shape. Passed and failed assertions count as
 * such; pending, skipped, todo and disabled are skipped. A file that failed without any assertion
 * (it did not load) is one failed case. Null when the text is not a results report.
 */
export function parseJestJson(text: string): CaseCounts | null {
  let doc: { testResults?: unknown };
  try {
    doc = JSON.parse(text) as { testResults?: unknown };
  } catch {
    return null;
  }
  if (!doc || !Array.isArray(doc.testResults)) return null;
  const counts: CaseCounts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const file of doc.testResults as JestFile[]) {
    const assertions = file.assertionResults ?? [];
    if (assertions.length === 0 && file.status === 'failed') counts.failed += 1;
    for (const assertion of assertions) {
      if (assertion.status === 'passed') counts.passed += 1;
      else if (assertion.status === 'failed') counts.failed += 1;
      else counts.skipped += 1;
    }
  }
  return counts;
}
