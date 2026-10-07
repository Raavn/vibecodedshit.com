import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as runCli } from '../src/cli.js';
import { band, cvss3BaseScore } from '../src/measure/deps/cvss.js';
import { isMajorBehind, latestStable, majorsBehind } from '../src/measure/deps/registry.js';
import { severityPoints } from '../src/measure/deps/osv.js';
import { loadMethodology } from '../src/methodology/load.js';
import { recompute } from '../src/run/recompute.js';
import type { RunFile, RunParameter } from '../src/run/schema.js';
import { runScan } from '../src/run/scan.js';
import { poolParameter } from '../src/scoring/pool.js';
import { ToolError } from '../src/scope/types.js';
import { compareVersions, parseVersion, poetryToPep440, satisfies } from '../src/util/pep440.js';
import { fixturesDir, materializeFixture } from './helpers/fixture.js';
import { fakeToolKit, ok, type FakeKit, type FakeTool } from './helpers/tools.js';

const methodology = loadMethodology('1.0');

const scan = (repoPath: string, tools: FakeKit, mode: 'preview' | 'full' = 'preview', asOf = '2026-10-04'): Promise<RunFile> =>
  runScan({ repoPath, methodologyVersion: '1.0', mode, asOf, tools });

const expected = (name: string): Record<string, never> =>
  JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Record<string, never>;

function param(run: RunFile, id: string): RunParameter {
  const found = run.parameters.find((p) => p.id === id);
  if (!found) throw new Error(`no parameter ${id}`);
  return found;
}

const base = (u: { package: string }): string => u.package.split('/').pop() ?? u.package;

// ---- helpers --------------------------------------------------------------------------------

describe('cvss.ts', () => {
  it.each([
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],
    ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N', 3.3],
    ['CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N', 0],
  ])('%s = %s', (vector, score) => {
    expect(cvss3BaseScore(vector)).toBe(score);
  });

  it('ignores CVSS v4 and garbage, and bands scores', () => {
    expect(cvss3BaseScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBeUndefined();
    expect(cvss3BaseScore('not a vector')).toBeUndefined();
    expect([9, 7, 4, 0.1, 0].map(band)).toEqual(['critical', 'high', 'moderate', 'low', 'none']);
  });
});

describe('pep440.ts', () => {
  const v = (text: string) => {
    const parsed = parseVersion(text);
    if (!parsed) throw new Error(text);
    return parsed;
  };

  it('orders versions', () => {
    const order = ['1.0.dev1', '1.0a1', '1.0b2', '1.0rc1', '1.0', '1.0.post1', '1.1', '2!0.1'];
    for (let i = 1; i < order.length; i += 1) {
      expect(compareVersions(v(order[i - 1] ?? ''), v(order[i] ?? ''))).toBe(-1);
    }
    expect(compareVersions(v('1.0'), v('1.0.0'))).toBe(0);
  });

  it('evaluates specifiers', () => {
    expect(satisfies('2.31.0', '>=2.0')).toBe(true);
    expect(satisfies('1.9', '>=2.0,<3')).toBe(false);
    expect(satisfies('0.6.3', '==0.6.*')).toBe(true);
    expect(satisfies('0.7.0', '==0.6.*')).toBe(false);
    expect(satisfies('1.4.5', '~=1.4.2')).toBe(true);
    expect(satisfies('1.5.0', '~=1.4.2')).toBe(false);
    expect(satisfies('1.0', '!=1.0')).toBe(false);
    expect(satisfies('1.2.3', '===1.2.3')).toBe(true);
    expect(satisfies('2.0', '<2.0')).toBe(false);
    expect(satisfies('1.0', '')).toBe(true);
  });

  it('converts Poetry constraints', () => {
    expect(poetryToPep440('^2.0')).toBe('>=2.0,<3');
    expect(poetryToPep440('^0.2.3')).toBe('>=0.2.3,<0.3');
    expect(poetryToPep440('~8.1')).toBe('>=8.1,<8.2');
    expect(poetryToPep440('~1')).toBe('>=1,<2');
    expect(poetryToPep440('*')).toBe('');
    expect(satisfies('3.0.0', poetryToPep440('^2.0'))).toBe(false);
  });
});

describe('pool.ts for number raws', () => {
  const def = methodology.dimensions.flatMap((d) => d.parameters).find((p) => p.id === '5.1');
  if (!def) throw new Error('no 5.1');

  it('sums number raws and scores the sum', () => {
    const unit = (points: number, pkg: string) => ({ package: pkg, group: 'typescript_javascript' as const, weight: 10, raw: { kind: 'number' as const, value: points } });
    const pooled = poolParameter(def, [unit(4, 'a'), unit(6, 'b')]);
    expect(pooled.raw).toEqual({ kind: 'number', value: 10 });
    expect(pooled.score).toBe(50);
  });

  it('scores 100 with no units', () => {
    const pooled = poolParameter(def, []);
    expect(pooled.raw).toBeNull();
    expect(pooled.score).toBe(100);
  });
});

// ---- 5.3 ------------------------------------------------------------------------------------

describe('5.3 lockfile', () => {
  const levels = async (name: string): Promise<Record<string, string>> => {
    const run = await scan(materializeFixture(name), fakeToolKit());
    return Object.fromEntries(
      (param(run, '5.3').units ?? []).map((u) => [base(u), u.raw.kind === 'level' ? u.raw.level : '?']),
    );
  };

  it('classifies every lockfile format as none, out_of_sync or in_sync', async () => {
    expect(await levels('d5-lockfile')).toEqual((expected('d5-lockfile') as never as { levels: Record<string, string> }).levels);
  });

  it('finds the lockfile of a workspace member at the repository root', async () => {
    expect(await levels('d5-lock-ws')).toEqual({ member: 'in_sync' });
  });

  it('reads Pipfile and Pipfile.lock', async () => {
    const run = await scan(materializeFixture('d5-lock-pipfile'), fakeToolKit());
    expect((param(run, '5.3').units ?? []).map((u) => u.raw)).toEqual([{ kind: 'level', level: 'in_sync' }]);
  });

  it('counts a hashed, fully pinned requirements file as a lockfile and a plain one as none', async () => {
    const hashed = await scan(materializeFixture('d5-lock-reqs'), fakeToolKit());
    expect((param(hashed, '5.3').units ?? []).map((u) => u.raw)).toEqual([{ kind: 'level', level: 'in_sync' }]);
    const plain = await scan(materializeFixture('d5-lock-reqs-plain'), fakeToolKit());
    expect((param(plain, '5.3').units ?? []).map((u) => u.raw)).toEqual([{ kind: 'level', level: 'none' }]);
  });

  it('weights units by logic lines and scores 0, 40 and 100 for none, out_of_sync and in_sync', async () => {
    const run = await scan(materializeFixture('d5-lockfile'), fakeToolKit());
    const p = param(run, '5.3');
    for (const unit of p.units ?? []) expect(unit.weight).toBe(3);
    const byLevel = Object.fromEntries((p.units ?? []).map((u) => [u.raw.kind === 'level' ? u.raw.level : '', u.score]));
    expect(byLevel).toEqual({ none: 0, out_of_sync: 40, in_sync: 100 });
    const total = (p.units ?? []).reduce((s, u) => s + u.score, 0) / (p.units ?? []).length;
    expect(p.score).toBeCloseTo(total, 6);
  });
});

// ---- 5.1 ------------------------------------------------------------------------------------

const cannedOsv = (): string => readFileSync(path.join(fixturesDir, 'd5-vuln', 'canned', 'osv.json'), 'utf8');

interface Call {
  args: string[];
  cwd: string;
}

function fakeOsv(calls: Call[] = [], report = cannedOsv(), exitCode = 1): FakeTool {
  return (args, cwd) => {
    calls.push({ args, cwd });
    writeFileSync(args[args.indexOf('--output-file') + 1] as string, report);
    return ok('', exitCode);
  };
}

const osvKit = (fake: FakeTool | null = fakeOsv(), version = '2.0.2'): FakeKit => fakeToolKit({ 'osv-scanner': fake }, { versions: { 'osv-scanner': version } });

describe('5.1 known vulnerabilities', () => {
  it('sums severity points, deduplicating aliases and dropping withdrawn, and honours --as-of', async () => {
    const want = expected('d5-vuln') as never as { production: Record<string, number>; devPoints: number };
    const calls: Call[] = [];
    const repo = materializeFixture('d5-vuln');
    const late = await scan(repo, osvKit(fakeOsv(calls)), 'preview', '2026-10-04');
    const early = await scan(repo, osvKit(), 'preview', '2022-01-01');
    expect(param(late, '5.1').raw).toEqual({ kind: 'number', value: want.production['2026-10-04'] });
    expect(param(early, '5.1').raw).toEqual({ kind: 'number', value: want.production['2022-01-01'] });
    expect(late.asOf).toBe('2026-10-04');
    expect(early.asOf).toBe('2022-01-01');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(0, 2)).toEqual(['scan', '-L']);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['--format', 'json', '--all-packages']));
    expect(late.tools.static?.['osv-scanner']).toBe('2.0.2');
  });

  it('puts dev-only advisories and the resolved package list in reportOnly, unscored', async () => {
    const run = await scan(materializeFixture('d5-vuln'), osvKit());
    const only = run.reportOnly as Record<string, unknown>;
    expect(only.devDependencyVulnerabilities).toEqual({
      points: 0.5,
      advisories: [{ package: '.', name: 'minimist', version: '1.2.0', id: 'GHSA-gggg-0007', severity: 'low' }],
    });
    expect((only.resolvedPackages as unknown[]).length).toBe(3);
    expect((only.resolvedPackages as { name: string; dev: boolean }[]).find((p) => p.name === 'minimist')?.dev).toBe(true);
  });

  it('counts an advisory with unknown severity as moderate', () => {
    const { points, advisories } = severityPoints(
      [{ name: 'x', version: '1', ecosystem: 'npm', dev: false, vulnerabilities: [{ id: 'GHSA-1' }, { id: 'GHSA-2', severity: [{ type: 'CVSS_V3', score: 'garbage' }] }] }],
      '2026-10-04',
    );
    expect(advisories.map((a) => a.severity)).toEqual(['moderate', 'moderate']);
    expect(points).toBe(4);
  });

  it('scores 100 when nothing is found and recompute reproduces the run', async () => {
    const run = await scan(materializeFixture('d5-vuln'), osvKit(fakeOsv([], JSON.stringify({ results: [] }), 0)));
    expect(param(run, '5.1').raw).toEqual({ kind: 'number', value: 0 });
    expect(param(run, '5.1').score).toBe(100);
    const again = recompute(run, methodology);
    expect(again.parameters).toEqual(run.parameters);
  });

  it('is not_measured in preview and a ToolError in full mode when osv-scanner is missing, old or fails', async () => {
    const repo = materializeFixture('d5-vuln');
    const missing = await scan(repo, osvKit(null));
    expect(param(missing, '5.1')).toMatchObject({ status: 'not_measured', reason: expect.stringMatching(/^osv-scanner not found/) });
    await expect(scan(repo, osvKit(null), 'full')).rejects.toBeInstanceOf(ToolError);
    const old = await scan(repo, osvKit(fakeOsv(), '1.9.2'));
    expect(param(old, '5.1')).toMatchObject({ status: 'not_measured', reason: 'osv-scanner 2.x required, found 1.9.2' });
    const crash = await scan(repo, osvKit(() => ok('', 127)));
    expect(param(crash, '5.1')).toMatchObject({ status: 'not_measured', reason: expect.stringMatching(/^osv-scanner exited with 127/) });
    const garbage = await scan(repo, osvKit(fakeOsv([], 'not json')));
    expect(param(garbage, '5.1').status).toBe('not_measured');
  });

  it('warns about a unit with no lockfile', async () => {
    const run = await scan(materializeFixture('d5-lockfile'), osvKit(fakeOsv([], JSON.stringify({ results: [] }), 0)));
    expect(run.warnings).toContain('5.1: pkgs/nolock has no lockfile, its dependencies were not scanned');
  });
});

// ---- 5.2 ------------------------------------------------------------------------------------

const npmDoc = (versions: Record<string, string>) => ({
  versions: Object.fromEntries(Object.keys(versions).map((v) => [v, {}])),
  time: { created: '2010-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', ...versions },
});

const T = (date: string): string => `${date}T00:00:00.000Z`;

const registryDocs: Record<string, unknown> = {
  'registry.npmjs.org/major': npmDoc({ '1.5.0': T('2020-01-01'), '2.0.0': T('2021-01-01') }),
  'registry.npmjs.org/zerominor': npmDoc({ '0.2.1': T('2020-01-01'), '0.3.0': T('2021-01-01') }),
  'registry.npmjs.org/zeropatch': npmDoc({ '0.2.1': T('2020-01-01'), '0.2.5': T('2021-01-01') }),
  'registry.npmjs.org/current': npmDoc({ '3.1.0': T('2020-01-01') }),
  'registry.npmjs.org/preonly': npmDoc({ '1.0.0': T('2020-01-01'), '1.9.0': T('2021-01-01'), '2.0.0-beta.1': T('2022-01-01') }),
  'registry.npmjs.org/late': npmDoc({ '1.0.0': T('2020-01-01'), '2.0.0': T('2025-05-01') }),
  'pypi.org/pypi/requests/json': {
    releases: {
      '2.0.0': [{ upload_time_iso_8601: '2013-09-24T00:00:00.000000Z', yanked: false }],
      '2.5.0': [{ upload_time_iso_8601: '2015-01-01T00:00:00.000000Z', yanked: false }],
      '3.0.0': [{ upload_time_iso_8601: '2024-01-01T00:00:00.000000Z', yanked: true }],
    },
  },
};

function fakeFetch(requested: string[] = [], failWith?: number): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input).replace(/^https:\/\//, '');
    requested.push(url);
    if (failWith !== undefined) return new Response('', { status: failWith });
    const doc = registryDocs[url];
    return doc === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(doc), { status: 200 });
  }) as typeof fetch;
}

describe('5.2 major versions behind', () => {
  const ratioOf = (run: RunFile, group: string) => {
    const unit = (param(run, '5.2').units ?? []).find((u) => u.group === group);
    if (unit?.raw.kind !== 'ratio') throw new Error('no ratio');
    return [unit.raw.numerator, unit.raw.denominator];
  };

  it('counts dependencies a major (or a 0.x minor) behind the latest stable at the as-of date', async () => {
    const want = expected('d5-outdated') as never as { asOf: Record<string, { ts: number[]; py: number[] }> };
    const repo = materializeFixture('d5-outdated');
    for (const date of ['2026-10-04', '2025-01-01']) {
      const requested: string[] = [];
      const run = await scan(repo, fakeToolKit({}, { fetch: fakeFetch(requested) }), 'preview', date);
      expect(ratioOf(run, 'typescript_javascript')).toEqual(want.asOf[date]?.ts);
      expect(ratioOf(run, 'python')).toEqual(want.asOf[date]?.py);
      expect(requested.some((u) => u.includes('alias') || u.includes('other'))).toBe(false);
      expect(requested).toContain('registry.npmjs.org/gone');
      expect(run.warnings).toContain('5.2: gone not found on the registry');
    }
  });

  it('stores the checked direct dependencies for health diff', async () => {
    const run = await scan(materializeFixture('d5-outdated'), fakeToolKit({}, { fetch: fakeFetch() }));
    const direct = (run.reportOnly as Record<string, { name: string; version: string; dev: boolean; package: string; group: string }[]>).directDependencies;
    expect(direct?.map((d) => d.name).sort()).toEqual(['current', 'late', 'major', 'preonly', 'requests', 'zerominor', 'zeropatch']);
    expect(direct?.find((d) => d.name === 'major')).toEqual({ package: '.', group: 'typescript_javascript', name: 'major', version: '1.5.0', dev: false });
  });

  it('is not_measured in preview and a ToolError in full mode on a registry failure', async () => {
    const repo = materializeFixture('d5-outdated');
    const preview = await scan(repo, fakeToolKit({}, { fetch: fakeFetch([], 503) }));
    expect(param(preview, '5.2')).toMatchObject({ status: 'not_measured', reason: expect.stringMatching(/^registry request .* failed: HTTP 503/) });
    await expect(scan(repo, fakeToolKit({}, { fetch: fakeFetch([], 503) }), 'full')).rejects.toBeInstanceOf(ToolError);
    const throwing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const offline = await scan(repo, fakeToolKit({}, { fetch: throwing }));
    expect(param(offline, '5.2').status).toBe('not_measured');
  });

  it('exports pure functions for rescoring', () => {
    expect(isMajorBehind('1.5.0', '2.0.0', 'typescript_javascript')).toBe(true);
    expect(isMajorBehind('0.2.1', '0.2.9', 'typescript_javascript')).toBe(false);
    expect(isMajorBehind('0.2.1', '0.3.0', 'python')).toBe(true);
    expect(isMajorBehind('3.0.0', '2.0.0', 'python')).toBe(false);
    const data = { versions: [{ version: '1.0', time: Date.parse('2020-01-01'), yanked: false }, { version: '2.0', time: Date.parse('2025-01-01'), yanked: false }, { version: '3.0.dev1', time: Date.parse('2025-02-01'), yanked: false }, { version: '2.1', time: Date.parse('2025-03-01'), yanked: true }] };
    expect(latestStable(data, 'python', '2026-01-01')).toBe('2.0');
    expect(latestStable(data, 'python', '2021-01-01')).toBe('1.0');
    const registryData = new Map([['python:x', data]]);
    const direct = [{ package: '.', group: 'python' as const, name: 'x', version: '1.0', dev: false }];
    expect(majorsBehind(direct, registryData, '2026-01-01')).toEqual({ numerator: 1, denominator: 1 });
    expect(majorsBehind(direct, registryData, '2021-01-01')).toEqual({ numerator: 0, denominator: 1 });
  });
});

// ---- 5.4 ------------------------------------------------------------------------------------

/** Built at run time so no secret-looking literal is committed. */
const fakeKey = (): string => `${'AK'}${'IA'}QWJZ7K3MPT5XRVN2`;

describe('5.4 secrets in the working tree', () => {
  function fakeGitleaks(calls: (Call & { files?: string[] })[] = [], inTree = true): FakeTool {
    return (args, cwd) => {
      const report = args[args.indexOf('--report-path') + 1] as string;
      const finding = { RuleID: 'aws-access-token', File: 'src/config.js', StartLine: 1, Commit: 'abc123', Secret: 'REDACTED' };
      if (args[0] === 'dir') {
        calls.push({ args, cwd, files: [] });
        writeFileSync(report, JSON.stringify(inTree ? [finding] : []));
      } else {
        calls.push({ args, cwd });
        writeFileSync(report, JSON.stringify([finding, { ...finding, Commit: 'def456' }]));
      }
      return ok();
    };
  }
  const repo = (): string => materializeFixture('d5-secret', {}, { 'src/config.js': `export const key = '${fakeKey()}';\n` });
  const kit = (fake: FakeTool | null): FakeKit => fakeToolKit({ gitleaks: fake }, { versions: { gitleaks: '8.28.0' } });

  it('counts a finding for the root package, scores 0 and records the history scan without secrets', async () => {
    const calls: Call[] = [];
    const run = await scan(repo(), kit(fakeGitleaks(calls)));
    const p = param(run, '5.4');
    expect((p.units ?? []).map((u) => u.raw)).toEqual([{ kind: 'number', value: 1 }]);
    expect(p.score).toBe(0);
    expect(calls[0]?.args.slice(0, 2)).toEqual(['dir', '.']);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['--exit-code', '0', '--redact', '--no-banner']));
    expect(calls[1]?.args[0]).toBe('git');
    const history = (run.reportOnly as Record<string, unknown>).secretsInHistory as { count: number; findings: Record<string, unknown>[] };
    expect(history.count).toBe(2);
    expect(Object.keys(history.findings[0] ?? {}).sort()).toEqual(['commit', 'file', 'line', 'ruleId']);
    expect(JSON.stringify(run)).not.toContain(fakeKey());
    expect(run.tools.static?.gitleaks).toBe('8.28.0');
  });

  it('copies tracked files including .gitleaksignore into the scan directory and uses an explicit config', async () => {
    let seen: { cwd: string; config: string } | undefined;
    const fake: FakeTool = (args, cwd) => {
      if (args[0] === 'dir') {
        const config = args[args.indexOf('--config') + 1] as string;
        seen = { cwd, config: readFileSync(config, 'utf8') };
        expect(readFileSync(path.join(cwd, '.gitleaksignore'), 'utf8')).toContain('fingerprints');
        expect(readFileSync(path.join(cwd, 'src/config.js'), 'utf8')).toContain(fakeKey());
      }
      writeFileSync(args[args.indexOf('--report-path') + 1] as string, '[]');
      return ok();
    };
    const run = await scan(repo(), kit(fake));
    expect(seen?.config).toBe('[extend]\nuseDefault = true\n');
    expect(param(run, '5.4').score).toBe(100);
    expect(run.ignoreSet.gitleaksignoreSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('only warns when the history scan fails', async () => {
    const fake: FakeTool = (args, cwd) => (args[0] === 'git' ? ok('', 2) : fakeGitleaks([], false)(args, cwd));
    const run = await scan(repo(), kit(fake));
    expect(param(run, '5.4').status).toBe('measured');
    expect(run.warnings).toContain('5.4: git history scan failed');
    expect((run.reportOnly as Record<string, unknown> | undefined)?.secretsInHistory).toBeUndefined();
  });

  it('is not_measured in preview and a ToolError in full mode without gitleaks or when it crashes', async () => {
    const missing = await scan(repo(), kit(null));
    expect(param(missing, '5.4')).toMatchObject({ status: 'not_measured', reason: expect.stringMatching(/^gitleaks not found/) });
    await expect(scan(repo(), kit(null), 'full')).rejects.toBeInstanceOf(ToolError);
    const crash = await scan(repo(), kit(() => ok('', 2)));
    expect(param(crash, '5.4')).toMatchObject({ status: 'not_measured', reason: expect.stringMatching(/^gitleaks exited with 2/) });
  });
});

// ---- 5.5 ------------------------------------------------------------------------------------

describe('5.5 dependency declaration errors', () => {
  function fakeDeptry(calls: { cwd: string; pyproject: string }[] = []): FakeTool {
    return (args, cwd) => {
      calls.push({ cwd, pyproject: readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8') });
      const error = (code: string, module: string) => ({ error: { code, message: code }, module, location: { file: 'app.py', line: 1, column: 1 } });
      writeFileSync(
        args[args.indexOf('--json-output') + 1] as string,
        JSON.stringify([error('DEP002', 'flask'), error('DEP001', 'numpy'), error('DEP001', 'numpy'), error('DEP003', 'urllib3'), error('DEP004', 'pytest')]),
      );
      return ok('', 1);
    };
  }

  it('counts unused plus unlisted for TypeScript (real knip) and DEP001-003 for Python (canned deptry)', async () => {
    const want = expected('d5-declarations') as never as Record<string, { numerator: number; denominator: number }>;
    const calls: { cwd: string; pyproject: string }[] = [];
    const run = await scan(materializeFixture('d5-declarations'), fakeToolKit({ deptry: fakeDeptry(calls) }, { versions: { deptry: '0.23.0' } }));
    const p = param(run, '5.5');
    expect(p.status).toBe('measured');
    for (const unit of p.units ?? []) {
      expect(unit.raw).toEqual({ kind: 'ratio', ...want[base(unit)], scale: 100 });
    }
    expect(p.raw).toEqual({ kind: 'ratio', numerator: 7, denominator: 8, scale: 100 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pyproject).not.toContain('deptry');
    expect(calls[0]?.pyproject).toContain('dependencies');
    expect(calls[0]?.cwd.endsWith('packages/api')).toBe(true);
    expect(run.tools.static?.deptry).toBe('0.23.0');
    expect(run.tools.static?.knip).toMatch(/^\d/);
  });

  it('is not_measured in preview and a ToolError in full mode when deptry is missing', async () => {
    const repo = materializeFixture('d5-declarations');
    const run = await scan(repo, fakeToolKit({ deptry: null }));
    expect(param(run, '5.5')).toMatchObject({ status: 'not_measured', reason: expect.stringMatching(/^deptry not found/) });
    await expect(scan(repo, fakeToolKit({ deptry: null }), 'full')).rejects.toBeInstanceOf(ToolError);
  });

  it('does not run deptry for a Python unit with no dependency manifest (deptry would exit 1 with no report)', async () => {
    const repo = materializeFixture('d5-declarations');
    execFileSync('git', ['-C', repo, 'rm', '-qf', 'packages/api/pyproject.toml']);
    const calls: { cwd: string; pyproject: string }[] = [];
    const run = await scan(repo, fakeToolKit({ deptry: fakeDeptry(calls) }));
    const p = param(run, '5.5');
    expect(p.status).toBe('measured');
    expect(calls).toHaveLength(0);
    // Without its pyproject.toml, app.py falls into the root package.
    expect(p.units?.find((u) => u.group === 'python')).toMatchObject({ package: '.', raw: { kind: 'ratio', numerator: 0, denominator: 0, scale: 100 } });
    expect(run.warnings).toContain('5.5: . has no Python dependency manifest');
  });

  it('does not need deptry for a TypeScript-only repository and scores 100 with no declared dependencies', async () => {
    const run = await scan(materializeFixture('d5-secret'), fakeToolKit());
    const p = param(run, '5.5');
    expect(p.status).toBe('measured');
    expect(p.score).toBe(100);
    expect(p.raw).toBeNull();
  });
});

// ---- --as-of --------------------------------------------------------------------------------

describe('--as-of', () => {
  it('defaults to today and is stored in run.json', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'health-cwd-'));
    const io = { stdout: () => undefined, stderr: () => undefined, cwd };
    expect(await runCli(['scan', materializeFixture('d5-secret'), '--preview'], io)).toBe(0);
    const file = JSON.parse(readFileSync(path.join(cwd, 'run.json'), 'utf8')) as RunFile;
    expect(file.asOf).toBe(new Date().toISOString().slice(0, 10));
  });
});
