import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT, run } from '../src/cli.js';
import { loadMethodology } from '../src/methodology/load.js';
import { renderReport } from '../src/report/render.js';
import type { RunFile, RunParameter } from '../src/run/schema.js';
import { precedenceRank } from '../src/route/order.js';
import { buildRoute, targetBand } from '../src/route/select.js';
import { makeRun } from './helpers/run.js';

const methodology = loadMethodology('1.0');
const workDir = mkdtempSync(path.join(tmpdir(), 'health-route-'));
let counter = 0;

const IDS = ['1.1', '2.1', '3.1', '4.1', '5.1', '6.1'] as const;
const weightOf = (id: string): number => {
  const def = methodology.dimensions.flatMap((d) => d.parameters).find((p) => p.id === id);
  if (!def) throw new Error(`no ${id}`);
  return def.weight;
};
const measured = (id: string, score: number): RunParameter => ({ id, status: 'measured', weight: weightOf(id), score });

/** One measured parameter per dimension, so each dimension scores exactly that parameter. */
function runWith(scores: number[], extra: Partial<RunFile> = {}, more: RunParameter[] = []): RunFile {
  return makeRun({ scores, parameters: [...IDS.map((id, i) => measured(id, scores[i] ?? 0)), ...more], ...extra });
}

async function cli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd: workDir });
  return { code, stdout, stderr };
}

function save(runFile: RunFile): string {
  const file = path.join(workDir, `run-${counter++}.json`);
  writeFileSync(file, JSON.stringify(runFile));
  return file;
}

const outDir = (): string => path.join(workDir, `route-${counter++}`);

// Fragile (48): 6.1 to 100 (+10), then 1.1 to 100 (+8.3, ahead of 3.1 on the id tie-break).
const fragile = (): RunFile => runWith([50, 50, 50, 50, 50, 40]);
// Vibe-coded (30): the cap binds until 6.1 leaves 0, then 6.1 recurs for its next anchor.
const vibeCoded = (): RunFile => runWith([50, 50, 50, 50, 50, 0]);

describe('route: Target band', () => {
  it('is Stable for Vibe-coded and Fragile, Agent-ready for Stable, none for Agent-ready', () => {
    expect(targetBand('vibe_coded', methodology)?.name).toBe('Stable');
    expect(targetBand('fragile', methodology)?.name).toBe('Stable');
    expect(targetBand('stable', methodology)?.name).toBe('Agent-ready');
    expect(targetBand('agent_ready', methodology)).toBeNull();
  });

  it('takes the lower bound from the methodology', () => {
    expect(targetBand('fragile', methodology)?.min).toBe(60);
    expect(targetBand('stable', methodology)?.min).toBe(80);
  });
});

describe('route: Steps and order', () => {
  it('picks the Step that raises health most each time and lists Slices in the fixed precedence', () => {
    const plan = buildRoute(fragile(), methodology);
    if (plan.kind !== 'route') throw new Error('expected a route');
    expect(plan.target.name).toBe('Stable');
    expect(plan.reached).toBe(true);
    expect(plan.slices.map((s) => [s.id, s.fromScore, s.toScore, s.healthBefore, s.healthAfter])).toEqual([
      ['6.1', 40, 100, 48, 58],
      ['1.1', 50, 100, 58, 67],
    ]);
    expect([plan.from, plan.to]).toEqual([48, 67]);
  });

  it('lets a parameter recur with its anchors ascending', () => {
    const plan = buildRoute(vibeCoded(), methodology);
    if (plan.kind !== 'route') throw new Error('expected a route');
    expect(plan.slices.map((s) => [s.id, s.toScore, s.healthAfter])).toEqual([
      ['6.1', 40, 48],
      ['6.1', 100, 58],
      ['1.1', 100, 67],
    ]);
  });

  it('ranks 3.x and 4.x after the listed parameters, 5.2 last', () => {
    const ids = ['5.2', '4.1', '3.2', '6.3', '2.4', '5.4'];
    expect([...ids].sort((a, b) => precedenceRank(a) - precedenceRank(b))).toEqual(['5.4', '2.4', '6.3', '3.2', '4.1', '5.2']);
  });

  it('aims a Stable repo at Agent-ready', () => {
    const plan = buildRoute(runWith([70, 70, 70, 70, 70, 70]), methodology);
    if (plan.kind !== 'route') throw new Error('expected a route');
    expect(plan.target.name).toBe('Agent-ready');
    expect(plan.to).toBeGreaterThanOrEqual(80);
  });

  it('gives an Agent-ready repo no Route', () => {
    expect(buildRoute(runWith([90, 90, 90, 90, 90, 90]), methodology)).toEqual({ kind: 'none' });
  });
});

describe('health route', () => {
  it('writes ROUTE.md and one file per Slice, and prints the summary line', async () => {
    const dir = outDir();
    const result = await cli(['route', save(fragile()), '--out', dir]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toBe('Route to Stable: 2 Slices, 48 -> 67\n');
    const names = readdirSync(dir).sort();
    expect(names[0]).toMatch(/^01-6-1-[a-z0-9-]+\.md$/);
    expect(names).toHaveLength(3);
    expect(names).toContain('ROUTE.md');
    const index = readFileSync(path.join(dir, 'ROUTE.md'), 'utf8');
    expect(index).toContain('# Route to Stable');
    expect(index).toMatch(/\| 1 \| \[6\.1 .*\]\(01-6-1-.*\.md\) \| 58 \|/);
    expect(index).toMatch(/\| 2 \| \[1\.1 .*\]\(02-1-1-.*\.md\) \| 67 \|/);
    const slice = readFileSync(path.join(dir, names[0] ?? ''), 'utf8');
    expect(slice).toContain('<!-- health:facts:start -->');
    expect(slice).toContain('**Health effect:** health 48 -> 58');
    expect(slice).toContain('## Task\n\n<!-- health:task -->');
  });

  it('deletes the earlier Slices on a re-run and leaves other files alone', async () => {
    const dir = outDir();
    const file = save(vibeCoded());
    await cli(['route', file, '--out', dir]);
    writeFileSync(path.join(dir, '09-old-slice.md'), 'old');
    writeFileSync(path.join(dir, 'notes.txt'), 'keep');
    await cli(['route', save(fragile()), '--out', dir]);
    expect(existsSync(path.join(dir, '09-old-slice.md'))).toBe(false);
    expect(readdirSync(dir).filter((n) => /^\d\d-/.test(n))).toHaveLength(2);
    expect(existsSync(path.join(dir, 'notes.txt'))).toBe(true);
  });

  it('refuses a preview run: one line, nothing written, exit 0', async () => {
    const dir = outDir();
    const result = await cli(['route', save(fragile_preview()), '--out', dir]);
    expect(result).toEqual({ code: EXIT.ok, stdout: 'Install Docker for a full run to get your Route\n', stderr: '' });
    expect(existsSync(dir)).toBe(false);
  });

  it('prints nothing and writes nothing for an Agent-ready repo', async () => {
    const dir = outDir();
    const result = await cli(['route', save(runWith([90, 90, 90, 90, 90, 90])), '--out', dir]);
    expect(result).toEqual({ code: EXIT.ok, stdout: '', stderr: '' });
    expect(existsSync(dir)).toBe(false);
  });

  it('leaves unmeasured parameters out of a non-comparable run and says so', async () => {
    const dir = outDir();
    const nonComparable = runWith([50, 50, 50, 50, 50, 40], { comparable: false, comparableReason: '4.2 not measured' }, [{ id: '4.2', status: 'not_measured', weight: weightOf('4.2') }]);
    const result = await cli(['route', save(nonComparable), '--out', dir]);
    expect(result.stdout).toBe('Route to Stable: 2 Slices, 48 -> 67\n');
    const index = readFileSync(path.join(dir, 'ROUTE.md'), 'utf8');
    expect(index).toContain('Not measured in this run, so this Route leaves them out: 4.2.');
    expect(readdirSync(dir).some((n) => n.includes('4-2'))).toBe(false);
  });

  it('stops when no Step adds health and says the Target band is out of reach', async () => {
    const stuck = runWith([0, 50, 50, 50, 50, 0], {}, [{ id: '5.2', status: 'not_measured', weight: weightOf('5.2') }]);
    const dir = outDir();
    const result = await cli(['route', save(stuck), '--out', dir]);
    expect(result.stdout).toBe('Route to Stable: 0 Slices, 30 -> 30\nStable is out of reach until 5.2 are measured; this Route gets you to 30\n');
    expect(readFileSync(path.join(dir, 'ROUTE.md'), 'utf8')).toContain('Stable is out of reach until 5.2 are measured; this Route gets you to 30');
  });

  it('rejects bad usage', async () => {
    expect((await cli(['route'])).code).toBe(EXIT.usage);
    expect((await cli(['route', save(fragile())])).code).toBe(EXIT.usage);
    expect((await cli(['route', save(fragile()), '--out', outDir(), '--check', outDir()])).code).toBe(EXIT.usage);
  });
});

function fragile_preview(): RunFile {
  return runWith([50, 50, 50, 50, 50, 40], { mode: 'preview', comparable: false, comparableReason: 'preview, not comparable' });
}

describe('health route --check', () => {
  async function written(): Promise<{ dir: string; file: string; tasks: string[] }> {
    const dir = outDir();
    const file = save(fragile());
    await cli(['route', file, '--out', dir]);
    const tasks = readdirSync(dir).filter((n) => n !== 'ROUTE.md');
    return { dir, file, tasks };
  }
  const fill = (dir: string, name: string): void => {
    const full = path.join(dir, name);
    writeFileSync(full, readFileSync(full, 'utf8').replace('<!-- health:task -->', 'Make the build pass: open package.json and fix the build script.'));
  };

  it('passes when the facts match and every Task is written', async () => {
    const { dir, file, tasks } = await written();
    for (const name of tasks) fill(dir, name);
    const result = await cli(['route', '--check', dir, file]);
    expect(result).toEqual({ code: EXIT.ok, stdout: 'Route files match run.json\n', stderr: '' });
  });

  it('fails while a Task placeholder is left', async () => {
    const { dir, file, tasks } = await written();
    fill(dir, tasks[0] ?? '');
    const result = await cli(['route', '--check', dir, file]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain(`${tasks[1]}: Task placeholder not replaced`);
  });

  it('fails when a number in the facts was edited', async () => {
    const { dir, file, tasks } = await written();
    for (const name of tasks) fill(dir, name);
    const full = path.join(dir, tasks[0] ?? '');
    writeFileSync(full, readFileSync(full, 'utf8').replace('health 48 -> 58', 'health 48 -> 90'));
    const result = await cli(['route', '--check', dir, file]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain(`${tasks[0]}: facts differ from run.json`);
  });

  it('fails when the run.json it is checked against differs', async () => {
    const { dir, tasks } = await written();
    for (const name of tasks) fill(dir, name);
    const result = await cli(['route', '--check', dir, save(vibeCoded())]);
    expect(result.code).toBe(EXIT.usage);
  });

  it('fails when the folder is missing', async () => {
    const result = await cli(['route', '--check', outDir(), save(fragile())]);
    expect(result.code).toBe(EXIT.usage);
  });
});

describe('report: Route section', () => {
  it('renders the Route to the Target band under the Roadmap', () => {
    const html = renderReport(fragile(), methodology);
    expect(html).toContain('<h2>Route to Stable</h2>');
    expect(html).toContain('Route to Stable: 2 Slices, 48 -&gt; 67');
    expect(html.indexOf('<h2>Route to Stable</h2>')).toBeGreaterThan(html.indexOf('<h2>Roadmap</h2>'));
  });

  it('renders the one-line refusal for a preview and nothing for an Agent-ready repo', () => {
    expect(renderReport(fragile_preview(), methodology)).toContain('Install Docker for a full run to get your Route');
    expect(renderReport(runWith([90, 90, 90, 90, 90, 90]), methodology)).not.toContain('<h2>Route');
  });
});
