import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPreviousRun } from '../src/card/previous.js';
import { cardSvg } from '../src/card/render.js';
import { EXIT, run } from '../src/cli.js';
import type { RunFile } from '../src/run/schema.js';
import { makeRun } from './helpers/run.js';

const repo = { path: '/work/laya-server', headCommit: null, treeHash: null };

/** Writes `<history>/<dir>/run.json` with its mtime `minutesAgo` in the past and returns the path. */
function save(history: string, dir: string, runFile: RunFile, minutesAgo: number): string {
  mkdirSync(path.join(history, dir), { recursive: true });
  const file = path.join(history, dir, 'run.json');
  writeFileSync(file, JSON.stringify(runFile));
  const when = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(file, when, when);
  return file;
}

async function cli(argv: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

describe('card: previous run', () => {
  it('picks the newest older run of the same repository, methodology version and mode', () => {
    const history = mkdtempSync(path.join(tmpdir(), 'health-card-'));
    save(history, 'oldest', makeRun({ repo, scores: [10, 10, 10, 10, 10, 10] }), 50);
    const previous = save(history, 'previous', makeRun({ repo, scores: [45, 45, 45, 45, 45, 45] }), 40);
    save(history, 'other-repo', makeRun({ repo: { ...repo, path: '/work/other' } }), 30);
    save(history, 'preview', makeRun({ repo, mode: 'preview' }), 25);
    save(history, 'other-version', makeRun({ repo, methodology: { version: '0.9' } }), 20);
    save(history, 'invalid', makeRun({ repo, valid: false, health: null }), 15);
    mkdirSync(path.join(history, 'no-run'));
    writeFileSync(path.join(history, 'broken.json'), '{');
    const current = makeRun({ repo, scores: [70, 70, 70, 70, 70, 70] });
    const currentFile = save(history, 'current', current, 10);
    save(history, 'later', makeRun({ repo }), 5);

    expect(findPreviousRun(currentFile, current, history)).toEqual({ file: previous, health: { score: 45, displayed: 45, band: 'fragile' } });
  });

  it('finds nothing on the first run of a repository', () => {
    const history = mkdtempSync(path.join(tmpdir(), 'health-card-'));
    const current = makeRun({ repo });
    expect(findPreviousRun(save(history, 'current', current, 1), current, history)).toBeNull();
  });
});

describe('card: svg', () => {
  const card = { repo: 'laya-server', before: { score: 38, tier: 'Vibe-coded' }, after: { score: 70, tier: 'Stable' } };
  const measure = (text: string, size: number) => [...text].length * size * 0.6;

  it('shows the brand and repository, both scores and the tier under each', () => {
    const svg = cardSvg(card, measure);
    expect(svg).toContain('>V\u{1F4A9}becodedsh\u{1F4A9}t.com report for laya-server</text>');
    expect(svg).toContain('>38</text>');
    expect(svg).toContain('>70</text>');
    expect(svg).toContain('>VIBE-CODED</text>');
    expect(svg).toContain('>STABLE</text>');
    expect(svg.indexOf('>38<')).toBeLessThan(svg.indexOf('>70<'));
  });

  it('escapes the repository name and shrinks the header to fit', () => {
    const svg = cardSvg({ ...card, repo: `<${'x'.repeat(60)}>` }, measure);
    expect(svg).toContain(`report for &lt;${'x'.repeat(60)}&gt;</text>`);
    const size = Number(/y="110" font-size="(\d+)"/.exec(svg)?.[1]);
    expect(size).toBeLessThan(44);
    expect(measure(`V💩becodedsh💩t.com report for <${'x'.repeat(60)}>`, size)).toBeLessThanOrEqual(1080);
  });
});

describe('card: command', () => {
  it('writes a 1200x630 PNG and prints its path when an earlier run exists', async () => {
    const history = mkdtempSync(path.join(tmpdir(), 'health-card-'));
    save(history, 'a', makeRun({ repo, scores: [45, 45, 45, 45, 45, 45] }), 10);
    const current = save(history, 'b', makeRun({ repo }), 1);
    const out = path.join(history, 'b', 'health-card.png');

    const result = await cli(['card', current, '--history', history, '--out', out], history);
    expect(result).toEqual({ code: EXIT.ok, stdout: `${out}\n`, stderr: '' });
    const png = readFileSync(out);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it('writes nothing and exits 0 on the first run', async () => {
    const history = mkdtempSync(path.join(tmpdir(), 'health-card-'));
    const current = save(history, 'a', makeRun({ repo }), 1);
    const result = await cli(['card', current, '--history', history], history);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('No card: no earlier full run of /work/laya-server');
    expect(existsSync(path.join(history, 'health-card.png'))).toBe(false);
  });

  it('needs --history', async () => {
    const history = mkdtempSync(path.join(tmpdir(), 'health-card-'));
    const result = await cli(['card', save(history, 'a', makeRun({ repo }), 1)], history);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain('Usage: health card');
  });
});
