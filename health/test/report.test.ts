import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXIT, run } from '../src/cli.js';
import { loadMethodology } from '../src/methodology/load.js';
import { SHALLOW_WARNING } from '../src/report-only/hotspots.js';
import { escapeHtml } from '../src/report/escape.js';
import { nearestDescriptor } from '../src/report/format.js';
import { renderReport } from '../src/report/render.js';
import type { RunFile } from '../src/run/schema.js';
import { runScan } from '../src/run/scan.js';
import { materializeFixture } from './helpers/fixture.js';
import { makeRun } from './helpers/run.js';
import { fakeToolKit } from './helpers/tools.js';

const methodology = loadMethodology('1.0');
const params = methodology.dimensions.flatMap((d) => d.parameters);
const workDir = mkdtempSync(path.join(tmpdir(), 'health-report-'));

let preview: RunFile;
beforeAll(async () => {
  preview = await runScan({ repoPath: materializeFixture('typescript'), methodologyVersion: '1.0', mode: 'preview', asOf: '2026-10-04', tools: fakeToolKit() });
});

async function cli(argv: string[], cwd = workDir): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

function save(name: string, runFile: unknown): string {
  const file = path.join(workDir, name);
  writeFileSync(file, JSON.stringify(runFile));
  return file;
}

describe('report: a preview run', () => {
  it('carries the not comparable label and the band meaning', () => {
    const html = renderReport(preview, methodology);
    expect(html).toContain('<span class="label">preview, not comparable</span>');
    const band = methodology.bands.find((b) => b.key === preview.health?.band);
    expect(html).toContain(escapeHtml(band?.meaning?.replace(/\s+/g, ' ').trim()));
    expect(html).toContain(`<span class="score">${preview.health?.displayed}</span>`);
  });

  it('lists every parameter and shows not_measured ones as not measured, unscored', () => {
    const html = renderReport(preview, methodology);
    for (const def of params) expect(html).toContain(`<td>${def.id}</td>`);
    const execution = preview.parameters.filter((p) => p.status === 'not_measured');
    expect(execution.length).toBeGreaterThan(0);
    expect(html).toContain('not measured</span>');
    expect(html).not.toContain('not_measured</span>');
    const row = new RegExp(`<tr><td>${execution[0]?.id.replace('.', '\\.')}</td>.*?</tr>`).exec(html)?.[0] ?? '';
    expect(row).toContain('not measured');
    expect(row).toContain('<td class="num">–</td>');
  });

  it('shows the raw value, score and nearest descriptor of a measured parameter', () => {
    const html = renderReport(preview, methodology);
    // 4.2 on the typescript fixture: 520 / 2033, score 48.8 (hand-counted in expected.json), nearest anchor 50.
    expect(html).toContain('520 / 2033 (25.6%)');
    expect(html).toContain('A quarter of the code lives in large files.');
  });

  it('shows the six dimensions, the breakdowns and the excluded-lines percentage', () => {
    const html = renderReport(preview, methodology);
    for (const d of methodology.dimensions) expect(html).toContain(escapeHtml(d.name));
    expect(html).toContain('By package');
    expect(html).toContain('By language group');
    expect(html).toContain(`${preview.ignoreSet.excludedLinesPercent}% of lines excluded by .healthignore`);
  });

  it('says not collected when the run has no report-only items', () => {
    const html = renderReport(makeRun(), methodology);
    expect(html.match(/not collected/g)).toHaveLength(3);
  });
});

describe('report: rendering rules', () => {
  it('is byte-identical on a second render', () => {
    expect(renderReport(preview, methodology)).toBe(renderReport(structuredClone(preview), methodology));
  });

  it('has no script and no external reference', () => {
    const html = renderReport(preview, methodology);
    // A URL inside a tool's reason is text, not a request; only attributes and url() can fetch.
    expect(html).not.toMatch(/url\(/);
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\ssrc=/);
    // The one allowed link is the help line.
    expect(html.replaceAll(' href="https://vibecodedshit.com"', '')).not.toMatch(/\shref=/);
  });

  it('allows exactly one link, to vibecodedshit.com, and only for a vibe_coded or fragile run', () => {
    const link = '<a href="https://vibecodedshit.com">';
    for (const scores of [[10, 10, 10, 10, 10, 10], [50, 50, 50, 50, 50, 50]]) {
      const html = renderReport(makeRun({ scores }), methodology);
      expect(html.split(link)).toHaveLength(2);
      expect(html.match(/\shref=/g)).toHaveLength(1);
      expect(html).toContain('If you want help working through this roadmap to Stable, Peter Kisel takes on this work: ');
      expect(html).not.toMatch(/\ssrc=|url\(|<script/);
    }
    for (const scores of [[70, 70, 70, 70, 70, 70], [90, 90, 90, 90, 90, 90]]) {
      const html = renderReport(makeRun({ scores }), methodology);
      expect(html).not.toContain('href=');
      expect(html).not.toContain('Peter Kisel');
    }
    const none = renderReport(makeRun({ health: null }), methodology);
    expect(none).not.toContain('href=');
    expect(none).toContain('no roadmap');
  });

  it('escapes untrusted strings', () => {
    const evil = '<script>alert(1)</script>';
    const runFile = makeRun({
      mode: 'preview',
      comparable: false,
      comparableReason: `<b>${evil}</b>`,
      breakdown: { byPackage: { [evil]: { '1': 50 } }, byGroup: {} },
      parameters: [{ id: '1.1', status: 'not_measured', reason: `"><img src=x onerror=alert(1)>`, weight: 10 }],
      repo: { path: `/tmp/${evil}`, headCommit: null, treeHash: null },
      reportOnly: { hotspots: [{ path: `src/${evil}.ts`, churn: 2, complexity: 3, score: 6 }] },
    });
    const html = renderReport(runFile, methodology);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('prints only whitelisted fields of secrets and vulnerabilities', () => {
    const runFile = makeRun({
      reportOnly: {
        secretsInHistory: {
          count: 1,
          findings: [{ ruleId: 'aws-key', file: 'config/prod.env', commit: 'abcdef0123456789abcdef', line: 3, secret: 'AKIASECRETVALUE', match: 'key=AKIASECRETVALUE' }],
        },
        devDependencyVulnerabilities: { points: 7, advisories: [{ package: '.', name: 'left-pad', version: '1.0.0', id: 'GHSA-1234', severity: 'high', summary: 'LEAKED-SUMMARY' }] },
      },
    });
    const html = renderReport(runFile, methodology);
    expect(html).toContain('aws-key');
    expect(html).toContain('config/prod.env');
    expect(html).toContain('<code>abcdef01</code>');
    expect(html).not.toContain('abcdef0123');
    expect(html).not.toContain('AKIASECRETVALUE');
    expect(html).toContain('left-pad');
    expect(html).toContain('GHSA-1234');
    expect(html).toContain('high');
    expect(html).not.toContain('LEAKED-SUMMARY');
  });

  it('lists the hotspots and prints the shallow warning beside them', () => {
    const runFile = makeRun({
      warnings: [SHALLOW_WARNING],
      reportOnly: { hotspots: [{ path: 'src/hot.ts', churn: 3, complexity: 6, score: 18 }] },
    });
    const html = renderReport(runFile, methodology);
    expect(html).toContain('<code>src/hot.ts</code>');
    expect(html).toContain(`<p class="note">${SHALLOW_WARNING}</p>`);
    expect(html.indexOf(SHALLOW_WARNING)).toBeLessThan(html.indexOf('src/hot.ts'));
  });
});

describe('report: roadmap', () => {
  it('shows the Roadmap after the dimensions and before the parameters, with Gain and the next anchor', () => {
    const run = makeRun({
      scores: [50, 50, 50, 50, 50, 50],
      parameters: params.map((d) => ({ id: d.id, status: 'measured' as const, weight: d.weight, score: 50 })),
    });
    const html = renderReport(run, methodology);
    expect(html.indexOf('<h2>Dimensions</h2>')).toBeLessThan(html.indexOf('<h2>Roadmap</h2>'));
    expect(html.indexOf('<h2>Roadmap</h2>')).toBeLessThan(html.indexOf('<h2>Parameters</h2>'));
    expect(html).toMatch(/<td class="num">\+\d+<\/td>|\+0 · no gain/);
    expect(html).toContain('<th class="num">Gain</th>');
  });

  it('says execution-layer parameters are not ranked in a preview', () => {
    expect(renderReport(preview, methodology)).toContain('Execution-layer parameters were not measured, so they are not ranked.');
    expect(renderReport(makeRun(), methodology)).not.toContain('Execution-layer parameters were not measured');
  });
});

describe('report: nearest descriptor', () => {
  const def = (id: string) => {
    const found = params.find((p) => p.id === id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };

  it('picks the anchor with the closest score', () => {
    expect(nearestDescriptor(def('4.1'), 100)).toBe('Every function can be read in one pass.');
    expect(nearestDescriptor(def('4.1'), 70)).toBe('A few hard functions.');
    expect(nearestDescriptor(def('4.1'), 3)).toBe('Logic is concentrated in functions nobody wants to touch.');
  });

  it('breaks a tie to the lower score', () => {
    // 62.5 is 12.5 from both 75 and 50.
    expect(nearestDescriptor(def('4.1'), 62.5)).toBe('Hard functions in most areas.');
  });

  it('uses levels for a level parameter and nothing for components', () => {
    expect(nearestDescriptor(def('2.2'), 40)).toContain('strict-family flags');
    expect(nearestDescriptor(def('6.5'), 50)).toBeNull();
  });
});

describe('report command', () => {
  it('prints the path, then up to 3 Roadmap lines', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-report-rm-'));
    const run = makeRun({ scores: [50, 50, 50, 50, 50, 50], parameters: params.map((d) => ({ id: d.id, status: 'measured' as const, weight: d.weight, score: 50 })) });
    const out = await cli(['report', save('roadmap.json', run)], cwd);
    const lines = out.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(path.join(cwd, 'health-report.html'));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^1\. \d\.\d .+ \(.+\) (\+\d+|\+0 · no gain)( — .+)?$/);
  });

  it('writes ./health-report.html in the working directory and prints only its path when there is no Roadmap', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-report-cwd-'));
    const input = save('good.json', makeRun({ health: null }));
    const out = await cli(['report', input], cwd);
    expect(out.code).toBe(EXIT.ok);
    const file = path.join(cwd, 'health-report.html');
    expect(out.stdout).toBe(`${file}\n`);
    expect(out.stderr).toBe('');
    expect(readFileSync(file, 'utf8')).toBe(renderReport(makeRun({ health: null }), methodology));
  });

  it('writes to --out', async () => {
    const target = path.join(mkdtempSync(path.join(tmpdir(), 'health-report-out-')), 'custom.html');
    const out = await cli(['report', save('good2.json', preview), '--out', target]);
    expect(out.code).toBe(EXIT.ok);
    expect(out.stdout.split('\n')[0]).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it('refuses an invalid run and names the reason', async () => {
    const out = await cli(['report', save('invalid.json', makeRun({ valid: false, invalidReason: 'tool crashed', health: null, dimensions: [] }))]);
    expect(out.code).toBe(EXIT.usage);
    expect(out.stderr).toBe('run.json is invalid: tool crashed\n');
  });

  it('exits 2 for a methodology version this CLI does not have', async () => {
    const out = await cli(['report', save('v9.json', makeRun({ methodology: { version: '9.9' } }))]);
    expect(out.code).toBe(EXIT.methodology);
  });

  it('exits 1 for usage, a missing file, bad JSON and a wrong schema version', async () => {
    expect((await cli(['report'])).code).toBe(EXIT.usage);
    expect((await cli(['report', path.join(workDir, 'nope.json')])).code).toBe(EXIT.usage);
    const bad = path.join(workDir, 'bad.json');
    writeFileSync(bad, 'nope');
    expect((await cli(['report', bad])).code).toBe(EXIT.usage);
    const wrong = await cli(['report', save('v2.json', { ...makeRun(), schemaVersion: 2 })]);
    expect(wrong.code).toBe(EXIT.usage);
    expect(wrong.stderr).toContain('schemaVersion');
  });
});
