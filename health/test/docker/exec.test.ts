import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { p21 } from '../../src/measure/p2-1.js';
import { p25 } from '../../src/measure/p2-5.js';
import { p61 } from '../../src/measure/p6-1.js';
import { runScan } from '../../src/run/scan.js';
import type { RunFile } from '../../src/run/schema.js';
import { fixturesDir, materializeFixture } from '../helpers/fixture.js';
import { fakeToolKit } from '../helpers/tools.js';

// Needs Docker and the health:1.0 image: `npm run image:build && npm run test:docker`.
const enabled = process.env.HEALTH_DOCKER === '1';

interface Expected {
  p61?: { level: string; score: number };
  p21?: { numerator: number; denominator: number };
  p25?: { numerator: number; denominator: number };
}
const expected = (name: string) => JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Expected;

function scan(name: string): Promise<RunFile> {
  return runScan({
    repoPath: materializeFixture(name),
    methodologyVersion: '1.0',
    mode: 'full',
    asOf: '2026-10-04',
    tools: fakeToolKit(),
    measurers: [p21, p25, p61],
  });
}
const param = (run: RunFile, id: string) => run.parameters.find((p) => p.id === id);

describe.skipIf(!enabled)('health:1.0 image', { timeout: 20 * 60_000 }, () => {
  it('records the image digest', async () => {
    const run = await scan('exec-lint-finding');
    expect(run.tools.image?.tag).toBe('health:1.0');
    expect(run.tools.image?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('exec-install-fail: every execution parameter is 0', async () => {
    const run = await scan('exec-install-fail');
    for (const id of ['6.1', '2.1', '2.5']) expect(param(run, id)?.score).toBe(0);
  });

  it('exec-build-fail: 6.1 is 40', async () => {
    const run = await scan('exec-build-fail');
    expect(param(run, '6.1')?.score).toBe(expected('exec-build-fail').p61?.score);
  });

  it('exec-type-error: the planted error is counted', async () => {
    const run = await scan('exec-type-error');
    const want = expected('exec-type-error').p21;
    expect(param(run, '2.1')?.raw).toEqual({ kind: 'ratio', numerator: want?.numerator, denominator: want?.denominator, scale: 1000 });
  });

  it('exec-lint-finding: the planted finding is counted', async () => {
    const run = await scan('exec-lint-finding');
    const want = expected('exec-lint-finding').p25;
    expect(param(run, '2.5')?.raw).toEqual({ kind: 'ratio', numerator: want?.numerator, denominator: want?.denominator, scale: 1000 });
  });

  it('exec-lint-outside-tsconfig: TS files outside every tsconfig are linted without type information', async () => {
    const run = await scan('exec-lint-outside-tsconfig');
    const want = expected('exec-lint-outside-tsconfig').p25;
    expect(param(run, '2.5')?.raw).toEqual({ kind: 'ratio', numerator: want?.numerator, denominator: want?.denominator, scale: 1000 });
  });
});
