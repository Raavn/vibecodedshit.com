import { describe, expect, it } from 'vitest';
import { getD3Graph } from '../src/measure/d3/index.js';
import type { Measurement, UnitRaw } from '../src/measure/types.js';
import { poolParameter } from '../src/scoring/pool.js';
import { cyclicFiles, d3Context, expected, graphOf, measure, methodology, rulesOf, violations } from './helpers/d3.js';
import { fakeGraphHelper } from './helpers/d3py.js';
import { materializeFixture } from './helpers/fixture.js';
import { fakeToolKit, ok } from './helpers/tools.js';

const FIXTURES = ['d3-django', 'd3-fastapi', 'd3-generic-py', 'd3-declared-py', 'd3-na-py', 'd3-domain-py'];

/** The graph helper is faked with the fixture's hand-written helper-out.json; imports_helper.py runs for real. */
async function contextOf(name: string, extra: Record<string, string> = {}, tracked: Record<string, string> = {}, mode: 'preview' | 'full' = 'preview') {
  const repoPath = materializeFixture(name, extra, tracked);
  return { repoPath, ctx: await d3Context(repoPath, fakeToolKit({ 'import-linter': fakeGraphHelper(name) }), mode) };
}

function units(m: Measurement): UnitRaw[] {
  if (m.status !== 'measured') throw new Error(`not measured: ${JSON.stringify(m)}`);
  return m.units;
}

function ratio(unit: UnitRaw | undefined): { numerator: number; denominator: number } {
  if (unit?.raw.kind !== 'ratio') throw new Error('not a ratio');
  return { numerator: unit.raw.numerator, denominator: unit.raw.denominator };
}

describe.each(FIXTURES)('D3 Python fixture %s', (name) => {
  const want = expected(name) as Record<string, Record<string, Record<string, unknown>> | string>;

  it('3.1 level per unit', async () => {
    const { ctx } = await contextOf(name);
    const got = Object.fromEntries(units(await measure(ctx, '3.1')).map((u) => [u.package, u.raw.kind === 'level' ? u.raw.level : null]));
    expect(got).toEqual(want['3.1']);
  });

  it('3.2 counts each violating edge once', async () => {
    const { ctx } = await contextOf(name);
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
    const { ctx } = await contextOf(name);
    const graph = await graphOf(ctx);
    const measured = units(await measure(ctx, '3.3'));
    for (const [pkg, exp] of Object.entries(want['3.3'] as Record<string, { numerator: number; denominator: number; files: string[] }>)) {
      expect(ratio(measured.find((u) => u.package === pkg))).toEqual({ numerator: exp.numerator, denominator: exp.denominator });
      expect(cyclicFiles(graph.units, pkg)).toEqual(exp.files);
    }
  });

  it('3.4 and 3.5 match or are not applicable', async () => {
    const { ctx } = await contextOf(name);
    for (const id of ['3.4', '3.5'] as const) {
      const exp = want[id];
      const result = await measure(ctx, id);
      if (exp === 'not_applicable') {
        expect(result.status).toBe('not_applicable');
        continue;
      }
      for (const [pkg, value] of Object.entries(exp as Record<string, { numerator: number; denominator: number; files?: string[] }>)) {
        expect(ratio(units(result).find((u) => u.package === pkg))).toEqual({ numerator: value.numerator, denominator: value.denominator });
      }
    }
  });

  it('adds the expected warnings', async () => {
    const { ctx } = await contextOf(name);
    const rules = await rulesOf(ctx);
    const graph = await graphOf(ctx);
    expect([...rules.warnings, ...graph.warnings]).toEqual((want.warnings as unknown as string[] | undefined) ?? []);
  });
});

describe('D3 Python domain purity (d3-domain-py)', () => {
  it('lists the impure files and ignores the test file under domain/', async () => {
    const { ctx } = await contextOf('d3-domain-py');
    const graph = await graphOf(ctx);
    const exp = expected('d3-domain-py') as unknown as Record<string, Record<string, { files: string[] }>>;
    const unit = graph.units[0];
    expect(unit?.domain.impure).toEqual(exp['3.5']?.['.']?.files);
    expect(unit?.domain.files).not.toContain('app/domain/test_pure.py');
    expect(unit?.domain.impure).not.toContain('app/domain/own_open.py');
    expect(unit?.domain.impure).not.toContain('app/domain/path_open.py');
  });

  it('a declared layers contract with a layer named domain defines the domain layer, with and without containers', async () => {
    const files = {
      'app/layered/__init__.py': '',
      'app/layered/domain.py': 'import django\n\n\ndef f():\n    return 1\n',
      'app/layered/web.py': 'import django\n\n\ndef f():\n    return 1\n',
      'app/other/domain.py': 'import requests\n\n\ndef f():\n    return 1\n',
    };
    const bare = await contextOf('d3-domain-py', {}, {
      ...files,
      '.importlinter': '[importlinter]\nroot_packages =\n    app\n\n[importlinter:contract:l]\nname = L\ntype = layers\nlayers =\n    app.layered.web\n    app.layered.domain\n',
    });
    const withContainers = await contextOf('d3-domain-py', {}, {
      ...files,
      '.importlinter': '[importlinter]\nroot_packages =\n    app\n\n[importlinter:contract:l]\nname = L\ntype = layers\ncontainers =\n    app.layered\n    app.other\nlayers =\n    web : domain\n',
    });
    const first = (await graphOf(bare.ctx)).units[0];
    expect(first?.domain.files).toContain('app/layered/domain.py');
    expect(first?.domain.files).not.toContain('app/layered/web.py');
    expect(first?.domain.files).not.toContain('app/other/domain.py');
    expect(first?.domain.impure).toContain('app/layered/domain.py');
    const second = (await graphOf(withContainers.ctx)).units[0];
    expect(second?.domain.files).toEqual(expect.arrayContaining(['app/layered/domain.py', 'app/other/domain.py']));
    expect(second?.domain.files).not.toContain('app/layered/web.py');
  });
});

describe('D3 Python 3.1 on d3-declared-py', () => {
  it('names the rules file', async () => {
    const { ctx } = await contextOf('d3-declared-py');
    expect((await rulesOf(ctx)).units[0]).toMatchObject({ rulesSource: 'declared', rulesFile: '.importlinter', level31: 'enforced' });
  });

  it('without a CI step the rules are declared', async () => {
    const { ctx } = await contextOf('d3-declared-py', {}, { '.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      - run: pytest\n' });
    expect(units(await measure(ctx, '3.1'))[0]?.raw).toEqual({ kind: 'level', level: 'declared' });
  });

  it('a protected contract alone does not govern: none, and the preset applies', async () => {
    const { ctx } = await contextOf('d3-declared-py', {}, {
      '.importlinter': '[importlinter]\nroot_packages =\n    core\n\n[importlinter:contract:p]\nname = P\ntype = protected\nprotected_modules = core\nallowed_importers = ui\n',
    });
    expect((await rulesOf(ctx)).units[0]).toMatchObject({ rulesSource: 'preset', level31: 'none' });
  });

  it('pyproject.toml contracts govern when no earlier file does, and a setup.cfg without the section is skipped', async () => {
    const { ctx } = await contextOf('d3-declared-py', {}, {
      '.importlinter': '[importlinter]\nroot_packages =\n    core\n',
      'setup.cfg': '[metadata]\nname = x\n',
      'pyproject.toml': '[project]\nname = "x"\n\n[tool.importlinter]\nroot_package = "core"\n\n[[tool.importlinter.contracts]]\nname = "indep"\ntype = "independence"\nmodules = ["core", "ui"]\n',
    });
    expect((await rulesOf(ctx)).units[0]).toMatchObject({ rulesSource: 'declared', rulesFile: 'pyproject.toml', level31: 'enforced' });
  });

  it('a setup.cfg with [importlinter] contracts governs before .importlinter', async () => {
    const { ctx } = await contextOf('d3-declared-py', {}, {
      'setup.cfg': '[importlinter]\nroot_package = core\n\n[importlinter:contract:f]\nname = F\ntype = forbidden\nsource_modules = core\nforbidden_modules = ui\n',
    });
    expect((await rulesOf(ctx)).units[0]).toMatchObject({ rulesFile: 'setup.cfg' });
  });

  it('a pyproject.toml that does not parse is treated as absent with a warning', async () => {
    const { ctx } = await contextOf('d3-declared-py', {}, {
      '.importlinter': '[importlinter]\nroot_packages =\n    core\n',
      'pyproject.toml': '[tool.importlinter\nbroken',
    });
    const rules = await rulesOf(ctx);
    expect(rules.units[0]).toMatchObject({ rulesSource: 'preset', level31: 'none' });
    expect(rules.warnings.join('\n')).toContain('pyproject.toml: could not be parsed, treated as absent');
  });
});

describe('D3 Python presets are chosen per workspace package', () => {
  it('d3-mixed-py: fastapi for services/api, django for services/admin', async () => {
    const repoPath = materializeFixture('d3-mixed-py');
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': fakeGraphHelper('d3-mixed-py') }));
    const want = expected('d3-mixed-py') as unknown as { presets: Record<string, string> };
    const rules = await rulesOf(ctx);
    expect(Object.fromEntries(rules.units.map((u) => [u.package, u.preset]))).toEqual(want.presets);
  });

  it('the unit result matches the hand counts for the django package and the fastapi package', async () => {
    const repoPath = materializeFixture('d3-mixed-py');
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': fakeGraphHelper('d3-mixed-py') }));
    const want = expected('d3-mixed-py') as unknown as Record<string, Record<string, { numerator: number; denominator: number; violating?: string[] }>>;
    const graph = await graphOf(ctx);
    const admin = graph.units.find((u) => u.package === 'services/admin');
    expect(admin ? violations(admin) : []).toEqual(want['3.2']?.['services/admin']?.violating);
    expect(ratio(units(await measure(ctx, '3.4')).find((u) => u.package === 'services/api'))).toEqual(want['3.4']?.['services/api']);
    expect(units(await measure(ctx, '3.4')).map((u) => u.package)).toEqual(['services/api']);
  });
});

describe('D3 mixed TypeScript and Python (d3-mixed)', () => {
  it('pools each parameter as the pooling rules state', async () => {
    const repoPath = materializeFixture('d3-mixed');
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': fakeGraphHelper('d3-mixed') }));
    const want = expected('d3-mixed') as unknown as Record<string, Record<string, { numerator: number; denominator: number }>> & {
      pooled: Record<string, { numerator: number; denominator: number; scale: number }>;
    };
    const graph = await graphOf(ctx);
    expect(graph.units.map((u) => [u.package, u.group])).toEqual([
      ['.', 'typescript_javascript'],
      ['api', 'python'],
    ]);
    for (const [pkg, exp] of Object.entries(want['3.2'] as Record<string, { numerator: number; denominator: number }>)) {
      expect(ratio(units(await measure(ctx, '3.2')).find((u) => u.package === pkg))).toEqual({ numerator: exp.numerator, denominator: exp.denominator });
    }
    for (const id of ['3.2', '3.3', '3.4'] as const) {
      const def = methodology.dimensions.flatMap((d) => d.parameters).find((p) => p.id === id);
      if (!def) throw new Error(id);
      expect(poolParameter(def, units(await measure(ctx, id))).raw).toEqual({ kind: 'ratio', ...want.pooled[id] });
    }
    expect((await measure(ctx, '3.5')).status).toBe('not_applicable');
    const levels = units(await measure(ctx, '3.1')).map((u) => [u.package, u.weight > 0, u.raw]);
    expect(levels).toEqual([
      ['.', true, { kind: 'level', level: 'none' }],
      ['api', true, { kind: 'level', level: 'none' }],
    ]);
  });
});

describe('D3 Python when the tool is unavailable', () => {
  it('3.2 to 3.5 are not_measured in preview and 3.1 still measures', async () => {
    const repoPath = materializeFixture('d3-na-py');
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': null }));
    for (const id of ['3.2', '3.3', '3.4', '3.5']) {
      expect(await measure(ctx, id)).toEqual({ status: 'not_measured', reason: expect.stringMatching(/^import-linter not found, install: pipx install import-linter/) });
    }
    expect((await measure(ctx, '3.1')).status).toBe('measured');
  });

  it('is not_measured in full mode too', async () => {
    const repoPath = materializeFixture('d3-na-py');
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': null }), 'full');
    expect(await measure(ctx, '3.2')).toEqual({ status: 'not_measured', reason: expect.stringMatching(/^import-linter not found/) });
  });

  it('a helper that exits non-zero is unavailable', async () => {
    const repoPath = materializeFixture('d3-na-py');
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': () => ({ exitCode: 2, stdout: '', stderr: 'Traceback boom', timedOut: false }) }));
    expect(await measure(ctx, '3.2')).toEqual({ status: 'not_measured', reason: 'import-linter failed: import-linter exited with 2: Traceback boom' });
  });

  it('a helper that reports an error is unavailable', async () => {
    const repoPath = materializeFixture('d3-na-py');
    const fake = fakeGraphHelper('d3-na-py', { solo: { error: 'unsupported import-linter 9.9: missing create_report' } });
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': fake }));
    const result = await getD3Graph(ctx('3.2'));
    expect(result).toEqual({ unavailable: 'import-linter failed: unsupported import-linter 9.9: missing create_report' });
  });

  it('unreadable helper output is unavailable', async () => {
    const repoPath = materializeFixture('d3-na-py');
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': () => ok() }));
    expect(await getD3Graph(ctx('3.2'))).toEqual({ unavailable: 'import-linter failed: unreadable output' });
  });

  it('records the grimp and import-linter versions the helper reports', async () => {
    const repoPath = materializeFixture('d3-na-py');
    const fake = fakeGraphHelper('d3-na-py', { solo: { versions: { grimp: '3.17', 'import-linter': '2.15' }, edges: [], violations: [] } });
    const ctx = await d3Context(repoPath, fakeToolKit({ 'import-linter': fake }));
    await getD3Graph(ctx('3.2'));
    expect(ctx('3.2').tools.versions()).toMatchObject({ grimp: '3.17', 'import-linter': '2.15' });
  });
});
