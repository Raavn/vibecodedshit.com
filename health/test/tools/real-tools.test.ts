import { describe, expect, it } from 'vitest';
import { runScan } from '../../src/run/scan.js';
import { createToolKit } from '../../src/tools/kit.js';
import { materializeFixture } from '../helpers/fixture.js';

/**
 * Runs the real Python tools. Needs `pipx install complexipy vulture` and HEALTH_TOOLS=1
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
});
