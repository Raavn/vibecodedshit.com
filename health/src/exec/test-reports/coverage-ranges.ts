import type { CoverageRange } from '../types.js';
import { toRepoPath } from '../reports.js';

interface Loc {
  start?: { line?: unknown };
  end?: { line?: unknown };
}

interface FileEntry {
  statementMap?: Record<string, Loc>;
  s?: Record<string, unknown>;
  fnMap?: Record<string, { loc?: Loc }>;
  f?: Record<string, unknown>;
}

function range(loc: Loc | undefined, hits: unknown): CoverageRange | null {
  const start = loc?.start?.line;
  const end = loc?.end?.line;
  if (typeof start !== 'number' || typeof end !== 'number' || typeof hits !== 'number') return null;
  return { start, end, hits };
}

/** The istanbul `json` reporter (`coverage-final.json`, also c8 and the v8 provider): the statement and function ranges of each file. Null when the text is not that report. */
export function parseCoverageRanges(text: string, stepDir: string): Map<string, CoverageRange[]> | null {
  let doc: Record<string, FileEntry>;
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  const files = new Map<string, CoverageRange[]>();
  for (const [file, entry] of Object.entries(doc)) {
    if (typeof entry !== 'object' || entry === null || typeof entry.statementMap !== 'object') return null;
    const ranges: CoverageRange[] = [];
    for (const [id, loc] of Object.entries(entry.statementMap)) {
      const found = range(loc, entry.s?.[id]);
      if (found) ranges.push(found);
    }
    for (const [id, fn] of Object.entries(entry.fnMap ?? {})) {
      const found = range(fn.loc, entry.f?.[id]);
      if (found) ranges.push(found);
    }
    files.set(toRepoPath(file, stepDir), ranges);
  }
  return files;
}

/**
 * The code lines of a file that ran: a line counts when the innermost statement or function range holding it
 * has a hit. A line inside no range counts when anything in the file ran. Lines are 1-based.
 */
export function coveredLines(codeLines: Iterable<number>, ranges: CoverageRange[]): Set<number> {
  const anyHit = ranges.some((r) => r.hits > 0);
  const covered = new Set<number>();
  for (const line of codeLines) {
    let best: CoverageRange | null = null;
    let hit = false;
    for (const r of ranges) {
      if (r.start > line || r.end < line) continue;
      const span = r.end - r.start;
      if (best === null || span < best.end - best.start) {
        best = r;
        hit = r.hits > 0;
      } else if (span === best.end - best.start && r.hits > 0) {
        hit = true;
      }
    }
    if (best === null ? anyHit : hit) covered.add(line);
  }
  return covered;
}
