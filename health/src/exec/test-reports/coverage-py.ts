import type { FileCoverage } from '../types.js';
import { toRepoPath } from '../reports.js';

interface Summary {
  num_statements?: unknown;
  covered_lines?: unknown;
  num_branches?: unknown;
  covered_branches?: unknown;
}

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** `coverage json` (pytest-cov `--cov-report=json`): `files.<path>.summary`. Null when the text is not that report. */
export function parseCoveragePy(text: string, stepDir: string): Map<string, FileCoverage> | null {
  let doc: { files?: Record<string, { summary?: Summary }> };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    return null;
  }
  if (!doc || typeof doc.files !== 'object' || doc.files === null) return null;
  const files = new Map<string, FileCoverage>();
  for (const [file, entry] of Object.entries(doc.files)) {
    const summary = entry?.summary ?? {};
    files.set(toRepoPath(file, stepDir), {
      lines: { total: num(summary.num_statements), covered: num(summary.covered_lines) },
      branches: { total: num(summary.num_branches), covered: num(summary.covered_branches) },
    });
  }
  return files;
}
