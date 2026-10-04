import { describe, expect, it } from 'vitest';
import { runScan } from '../../src/run/scan.js';
import { createToolKit } from '../../src/tools/kit.js';
import { materializeFixture } from '../helpers/fixture.js';

/**
 * Runs the real Python tools. Needs `pipx install complexipy vulture deptry`, `brew install osv-scanner gitleaks` and HEALTH_TOOLS=1
 * (`npm run test:tools`); skipped otherwise. The default tests drive these tools with fakes.
 */
describe.skipIf(!process.env.HEALTH_TOOLS)('real static tools', () => {
  const scan = (name: string) =>
    runScan({ repoPath: materializeFixture(name), methodologyVersion: '1.0', mode: 'preview', asOf: '2026-10-04', tools: createToolKit() });

  it('complexipy gives the hand-counted Python result for 4.1', async () => {
    const run = await scan('d4-complexity');
    const p = run.parameters.find((x) => x.id === '4.1');
    expect(p?.status).toBe('measured');
    const api = p?.units?.find((u) => u.group === 'python');
    expect(api?.raw).toEqual({ kind: 'ratio', numerator: 1, denominator: 10, scale: 100 });
    expect(run.tools.static?.complexipy).toMatch(/^\d/);
  });

  it('vulture at min-confidence 60 gives the hand-counted Python result for 4.4', async () => {
    const run = await scan('d4-deadcode');
    const p = run.parameters.find((x) => x.id === '4.4');
    expect(p?.status).toBe('measured');
    const api = p?.units?.find((u) => u.group === 'python');
    expect(api?.raw).toEqual({ kind: 'ratio', numerator: 5, denominator: 12, scale: 100 });
    expect(run.tools.static?.vulture).toMatch(/^\d/);
  });

  it('osv-scanner counts lodash 4.17.20 as 0 points at 2020-01-01 and more at 2024-01-01 (npm lockfile)', async () => {
    const repo = materializeFixture('d5-vuln');
    const point = async (asOf: string) => {
      const result = await runScan({ repoPath: repo, methodologyVersion: '1.0', mode: 'preview', asOf, tools: createToolKit() });
      const raw = result.parameters.find((x) => x.id === '5.1')?.raw;
      return raw?.kind === 'number' ? raw.value : Number.NaN;
    };
    expect(await point('2020-01-01')).toBe(0);
    expect(await point('2024-01-01')).toBeGreaterThan(0);
  });

  it('osv-scanner reads a uv.lock', async () => {
    const repo = materializeFixture('d5-lockfile');
    const result = await runScan({ repoPath: repo, methodologyVersion: '1.0', mode: 'preview', asOf: '2026-10-04', tools: createToolKit() });
    expect(result.parameters.find((x) => x.id === '5.1')?.status).toBe('measured');
    expect(result.tools.static?.['osv-scanner']).toMatch(/^\d/);
  });

  it('gitleaks finds a planted secret and a .gitleaksignore fingerprint suppresses it', async () => {
    const key = `${'AK'}${'IA'}QWJZ7K3MPT5XRVN2`;
    const secret = { 'src/config.js': `export const key = '${key}';\n` };
    const count = async (repo: string) => {
      const result = await runScan({ repoPath: repo, methodologyVersion: '1.0', mode: 'preview', asOf: '2026-10-04', tools: createToolKit() });
      const raw = result.parameters.find((x) => x.id === '5.4')?.units?.[0]?.raw;
      return raw?.kind === 'number' ? raw.value : Number.NaN;
    };
    expect(await count(materializeFixture('d5-secret', {}, secret))).toBe(1);
    expect(await count(materializeFixture('d5-secret', {}, { ...secret, '.gitleaksignore': 'src/config.js:aws-access-token:1\n' }))).toBe(0);
  });

  it('deptry gives a ratio for the Python package in d5-declarations', async () => {
    const result = await runScan({ repoPath: materializeFixture('d5-declarations'), methodologyVersion: '1.0', mode: 'preview', asOf: '2026-10-04', tools: createToolKit() });
    const unit = result.parameters.find((x) => x.id === '5.5')?.units?.find((u) => u.group === 'python');
    expect(unit?.raw.kind).toBe('ratio');
    expect(result.tools.static?.deptry).toMatch(/^\d/);
  });
});
