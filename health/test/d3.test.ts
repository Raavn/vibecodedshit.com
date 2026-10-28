import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Measurement, UnitRaw } from '../src/measure/types.js';
import { cyclicFiles, d3Context, expected, fixtureContext, graphOf, measure, rulesOf, violations } from './helpers/d3.js';
import { materializeFixture } from './helpers/fixture.js';
import { fakeToolKit } from './helpers/tools.js';

const FIXTURES = ['d3-nextjs', 'd3-alias-ts', 'd3-express', 'd3-generic-ts', 'd3-declared-ts', 'd3-na-ts', 'd3-domain-ts'];

function units(m: Measurement): UnitRaw[] {
  if (m.status !== 'measured') throw new Error(`not measured: ${JSON.stringify(m)}`);
  return m.units;
}

function ratio(unit: UnitRaw | undefined): { numerator: number; denominator: number } {
  if (unit?.raw.kind !== 'ratio') throw new Error('not a ratio');
  return { numerator: unit.raw.numerator, denominator: unit.raw.denominator };
}

describe.each(FIXTURES)('D3 fixture %s', (name) => {
  const want = expected(name) as Record<string, Record<string, Record<string, unknown>> | string>;

  it('3.1 level per unit', async () => {
    const { ctx } = await fixtureContext(name);
    const got = Object.fromEntries(units(await measure(ctx, '3.1')).map((u) => [u.package, u.raw.kind === 'level' ? u.raw.level : null]));
    expect(got).toEqual(want['3.1']);
  });

  it('3.2 counts each violating edge once', async () => {
    const { ctx } = await fixtureContext(name);
    const graph = await graphOf(ctx);
    const measured = units(await measure(ctx, '3.2'));
    for (const [pkg, exp] of Object.entries(want['3.2'] as Record<string, { numerator: number; denominator: number; violating: string[] }>)) {
      const unit = graph.units.find((u) => u.package === pkg);
      expect(ratio(measured.find((u) => u.package === pkg))).toEqual({ numerator: exp.numerator, denominator: exp.denominator });
      expect(unit ? violations(unit) : undefined).toEqual(exp.violating);
    }
    expect(measured.find((u) => u.raw.kind === 'ratio' && u.raw.scale !== 1000)).toBeUndefined();
  });

  it('3.3 counts files in cycles', async () => {
    const { ctx } = await fixtureContext(name);
    const graph = await graphOf(ctx);
    const measured = units(await measure(ctx, '3.3'));
    for (const [pkg, exp] of Object.entries(want['3.3'] as Record<string, { numerator: number; denominator: number; files: string[] }>)) {
      expect(ratio(measured.find((u) => u.package === pkg))).toEqual({ numerator: exp.numerator, denominator: exp.denominator });
      expect(cyclicFiles(graph.units, pkg)).toEqual(exp.files);
    }
  });

  it('3.4 and 3.5 match or are not applicable', async () => {
    const { ctx } = await fixtureContext(name);
    for (const id of ['3.4', '3.5'] as const) {
      const exp = want[id];
      const result = await measure(ctx, id);
      if (exp === 'not_applicable') {
        expect(result.status).toBe('not_applicable');
        continue;
      }
      const only = units(result);
      for (const [pkg, value] of Object.entries(exp as Record<string, { numerator: number; denominator: number }>)) {
        expect(ratio(only.find((u) => u.package === pkg))).toEqual({ numerator: value.numerator, denominator: value.denominator });
      }
    }
  });
});

describe('D3 domain purity (d3-domain-ts)', () => {
  it('lists the impure files, ignores the test file under domain/ and the file that declares its own fetch', async () => {
    const { ctx } = await fixtureContext('d3-domain-ts');
    const graph = await graphOf(ctx);
    const exp = expected('d3-domain-ts') as unknown as Record<string, Record<string, { files: string[] }>>;
    expect(graph.units[0]?.domain.impure).toEqual(exp['3.5']?.['.']?.files);
    expect(graph.units[0]?.domain.files).not.toContain('src/domain/order.test.ts');
    expect(graph.units[0]?.domain.impure).not.toContain('src/domain/local-fetch.ts');
  });
});

describe('D3 3.1 on d3-declared-ts', () => {
  it('names the rules file and records the skipped allowed list as a warning', async () => {
    const { ctx } = await fixtureContext('d3-declared-ts');
    const rules = await rulesOf(ctx);
    expect(rules.units[0]).toMatchObject({ rulesSource: 'declared', rulesFile: '.dependency-cruiser.js', level31: 'enforced' });
    expect(rules.warnings.join('\n')).toContain('allowed rule #1 skipped');
    expect(rules.warnings.join('\n')).toContain('whole "allowed" list is dropped');
  });

  it('one more level (check, verify, lint, arch) stays declared', async () => {
    const { ctx } = await fixtureContext('d3-declared-ts', {}, {
      Makefile: 'check:\n\tnpm run verify\n',
      'package.json': JSON.stringify({ name: 'x', scripts: { verify: 'npm run lint', lint: 'npm run arch', arch: 'depcruise src' } }),
    });
    expect((await measure(ctx, '3.1')) && units(await measure(ctx, '3.1'))[0]?.raw).toEqual({ kind: 'level', level: 'declared' });
  });

  it('a default-only rules file is none and the preset applies', async () => {
    const { ctx } = await fixtureContext('d3-declared-ts', {}, {
      '.dependency-cruiser.js': "module.exports = { forbidden: [{ name: 'not-to-spec', severity: 'error', from: {}, to: { path: '[.]test[.]ts$' } }] };\n",
    });
    expect((await rulesOf(ctx)).units[0]).toMatchObject({ rulesSource: 'preset', level31: 'none' });
    const [unit] = (await graphOf(ctx)).units;
    expect(unit?.violating).toEqual([]);
  });

  it('a rules file that does not parse is treated as absent with a warning', async () => {
    const { ctx } = await fixtureContext('d3-declared-ts', {}, { '.dependency-cruiser.js': 'module.exports = require("./other");\n' });
    const rules = await rulesOf(ctx);
    expect(rules.units[0]).toMatchObject({ rulesSource: 'preset', level31: 'none' });
    expect(rules.warnings.join('\n')).toContain('treated as absent');
  });

  it('a CI file that does not run depcruise leaves a declared file declared', async () => {
    const { ctx } = await fixtureContext('d3-declared-ts', {}, { '.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      - run: npm test\n' });
    expect(units(await measure(ctx, '3.1'))[0]?.raw).toEqual({ kind: 'level', level: 'declared' });
  });
});

describe('D3 when the tool is unavailable', () => {
  it('3.2 to 3.5 are not_measured in preview and 3.1 still measures', async () => {
    const { ctx } = await fixtureContext('d3-na-ts');
    const failing = ctx('3.2');
    // dependency-cruiser cannot be unavailable on disk, so a poisoned memo stands in for a failed run
    await failing.tools.memo(`d3:graph:${failing.repoPath}`, async () => ({ unavailable: 'dependency-cruiser failed: boom' }));
    for (const id of ['3.2', '3.3', '3.4', '3.5']) {
      expect(await measure(ctx, id)).toEqual({ status: 'not_measured', reason: 'dependency-cruiser failed: boom' });
    }
    expect((await measure(ctx, '3.1')).status).toBe('measured');
  });

  it('is not_measured in full mode too', async () => {
    const repo = await fixtureContext('d3-na-ts');
    const full = await d3Context(repo.repoPath, fakeToolKit(), 'full');
    const target = full('3.2');
    await target.tools.memo(`d3:graph:${target.repoPath}`, async () => ({ unavailable: 'dependency-cruiser failed: boom' }));
    expect(await measure(full, '3.2')).toEqual({ status: 'not_measured', reason: 'dependency-cruiser failed: boom' });
  });
});

describe('D3 tsconfig aliases', () => {
  it('resolves @/ imports through the package tsconfig', async () => {
    const { ctx } = await fixtureContext('d3-nextjs');
    const edges = (await graphOf(ctx)).units[0]?.edges ?? [];
    expect(edges.some((e) => e.from === 'src/app/page.tsx' && e.to === 'src/components/button.tsx')).toBe(true);
  });
});

describe('D3 repository behind a symlink', () => {
  it('3.2 gives the same ratio when the repository path is a symlink', async () => {
    const real = materializeFixture('d3-na-ts');
    const link = path.join(mkdtempSync(path.join(tmpdir(), 'health-link-')), 'repo');
    symlinkSync(real, link, 'dir');
    const ctx = await d3Context(link);
    const want = expected('d3-na-ts') as Record<string, Record<string, { numerator: number; denominator: number }>>;
    const measured = units(await measure(ctx, '3.2'));
    for (const [pkg, exp] of Object.entries(want['3.2'] as Record<string, { numerator: number; denominator: number }>)) {
      expect(ratio(measured.find((u) => u.package === pkg))).toEqual({ numerator: exp.numerator, denominator: exp.denominator });
    }
  });
});
