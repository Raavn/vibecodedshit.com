import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { p11 } from '../../src/measure/p1-1.js';
import { p12 } from '../../src/measure/p1-2.js';
import { p13 } from '../../src/measure/p1-3.js';
import { p63 } from '../../src/measure/p6-3.js';
import { p21 } from '../../src/measure/p2-1.js';
import { p25 } from '../../src/measure/p2-5.js';
import { p61 } from '../../src/measure/p6-1.js';
import { runScan } from '../../src/run/scan.js';
import type { RunFile } from '../../src/run/schema.js';
import { fixturesDir, materializeFixture } from '../helpers/fixture.js';
import { fakeToolKit } from '../helpers/tools.js';

// Needs Docker and the health:1.0 image: `npm run image:build && npm run test:docker`. Each fixture installs its
// dependencies from the network, so these are slow.
const enabled = process.env.HEALTH_DOCKER === '1';

interface Expected {
  p11: { numerator: number; denominator: number };
  p12: { numerator: number; denominator: number };
  p13: { numerator: number; denominator: number };
}
const expected = (name: string) => JSON.parse(readFileSync(path.join(fixturesDir, name, 'expected.json'), 'utf8')) as Expected;
const param = (run: RunFile, id: string) => run.parameters.find((p) => p.id === id);

describe.skipIf(!enabled)('health:1.0 test runners', { timeout: 30 * 60_000 }, () => {
  it.each(['vitest', 'jest', 'mocha', 'node-test', 'pytest', 'unittest', 'tox', 'nox'])('exec-tests-%s', async (name) => {
    const fixture = `exec-tests-${name}`;
    const run = await runScan({
      repoPath: materializeFixture(fixture),
      methodologyVersion: '1.0',
      mode: 'full',
      asOf: '2026-10-04',
      tools: fakeToolKit(),
      measurers: [p11, p12, p13, p63, p21, p25, p61],
    });
    const want = expected(fixture);
    for (const [id, key] of [['1.1', 'p11'], ['1.2', 'p12'], ['1.3', 'p13']] as const) {
      expect(param(run, id)?.raw).toEqual({ kind: 'ratio', numerator: want[key].numerator, denominator: want[key].denominator, scale: 100 });
    }
    expect(run.execution?.feedbackLoop.totalSeconds).toBeGreaterThan(0);
  });
});
