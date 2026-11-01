import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { churnWindow, computeHotspots, SHALLOW_WARNING } from '../src/report-only/hotspots.js';
import { runScan } from '../src/run/scan.js';
import { fakeToolKit } from './helpers/tools.js';

const AS_OF = '2026-10-04';

function git(dir: string, args: string[], date?: string): void {
  const env = { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  const result = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

function commit(dir: string, date: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', `change ${date}`], date);
}

// Cognitive complexity by hand: `if` +1, nested `for` +2, `if` nested twice +3 = 6.
const hot = (n: number): string => `export function hot(a: number, b: number): number {
  // revision ${n}
  if (a > 0) {
    for (let i = 0; i < b; i += 1) {
      if (i % 2 === 0) {
        return i;
      }
    }
  }
  return 0;
}
`;
// One `if` = 1.
const warm = (n: number): string => `export function warm(a: number): number {
  // revision ${n}
  if (a > 0) {
    return 1;
  }
  return 0;
}
`;
const calm = `export function calm(a: number): number {
  return a + 1;
}
`;
// Two sequential `if` = 2.
const old = `export function old(a: number): number {
  if (a > 0) {
    return 1;
  }
  if (a < 0) {
    return -1;
  }
  return 0;
}
`;

function history(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'health-hotspots-'));
  git(dir, ['init', '-q']);
  commit(dir, '2025-01-01T12:00:00+00:00', { 'src/old.ts': old, 'src/hot.ts': hot(1) }); // outside the window
  commit(dir, '2025-11-01T12:00:00+00:00', { 'src/hot.ts': hot(2), 'src/warm.ts': warm(1), 'src/calm.ts': calm });
  commit(dir, '2026-03-01T12:00:00+00:00', { 'src/hot.ts': hot(3), 'src/warm.ts': warm(2) });
  commit(dir, '2026-09-01T12:00:00+00:00', { 'src/hot.ts': hot(4) });
  commit(dir, '2026-10-05T12:00:00+00:00', { 'src/hot.ts': hot(5), 'src/warm.ts': warm(3) }); // after the as-of day
  return dir;
}

describe('hotspots', () => {
  it('uses the 12 months up to the end of the as-of day, UTC', () => {
    expect(churnWindow(AS_OF)).toEqual({ since: '2025-10-04T00:00:00+00:00', until: '2026-10-04T23:59:59+00:00' });
  });

  it('ranks churn x complexity from a real scan, ignoring commits outside the window', async () => {
    const repo = history();
    const run = await runScan({ repoPath: repo, methodologyVersion: '1.0', mode: 'preview', asOf: AS_OF, tools: fakeToolKit() });
    // hot.ts: 3 commits in the window x complexity 6. warm.ts: 2 commits x 1. calm.ts has churn but no complexity. old.ts has complexity but no churn in the window.
    expect(run.reportOnly?.hotspots).toEqual([
      { path: 'src/hot.ts', churn: 3, complexity: 6, score: 18 },
      { path: 'src/warm.ts', churn: 2, complexity: 1, score: 2 },
    ]);
    expect(run.warnings).not.toContain(SHALLOW_WARNING);
  });

  it('records that no Python file is in scope for a TypeScript-only repo', async () => {
    const run = await runScan({ repoPath: history(), methodologyVersion: '1.0', mode: 'preview', asOf: AS_OF, tools: fakeToolKit() });
    expect(run.reportOnly?.pythonInScope).toBe(false);
  });

  it('leaves out zero-churn and zero-complexity files and breaks ties by path', () => {
    const repo = history();
    const result = computeHotspots(repo, AS_OF, [
      { file: 'src/warm.ts', complexitySum: 3 }, // 2 x 3 = 6
      { file: 'src/hot.ts', complexitySum: 2 }, // 3 x 2 = 6
      { file: 'src/old.ts', complexitySum: 2 }, // no churn in the window
      { file: 'src/calm.ts', complexitySum: 0 }, // no complexity
      { file: 'src/missing.ts', complexitySum: 9 }, // never committed
    ]);
    expect(result.hotspots.map((h) => [h.path, h.score])).toEqual([
      ['src/hot.ts', 6],
      ['src/warm.ts', 6],
    ]);
  });

  it('stores the top 20 only', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'health-hotspots-many-'));
    git(dir, ['init', '-q']);
    const files = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${String(i).padStart(2, '0')}.ts`, `export const v${i} = ${i};\n`]));
    commit(dir, '2026-01-01T12:00:00+00:00', files);
    const result = computeHotspots(dir, AS_OF, Object.keys(files).map((file, i) => ({ file, complexitySum: i + 1 })));
    expect(result.hotspots).toHaveLength(20);
    expect(result.hotspots[0]?.path).toBe('f24.ts');
  });

  it('warns that a shallow clone gives a lower bound', async () => {
    const source = history();
    const clone = path.join(mkdtempSync(path.join(tmpdir(), 'health-shallow-')), 'clone');
    const result = spawnSync('git', ['clone', '-q', '--depth', '1', `file://${source}`, clone], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(computeHotspots(clone, AS_OF, []).warnings).toEqual([SHALLOW_WARNING]);
    const run = await runScan({ repoPath: clone, methodologyVersion: '1.0', mode: 'preview', asOf: '2026-10-06', tools: fakeToolKit() });
    expect(run.warnings).toContain(SHALLOW_WARNING);
  });
});
