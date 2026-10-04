import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HelperOutput } from '../../src/measure/d3/py/graph.js';
import { getD3Graph } from '../../src/measure/d3/index.js';
import { createToolKit, type ToolKit } from '../../src/tools/kit.js';
import { d3Context } from '../helpers/d3.js';
import { normalizeHelperOut, outKey, readHelperOuts } from '../helpers/d3py.js';
import { fixturesDir, materializeFixture } from '../helpers/fixture.js';

/**
 * Runs the real helper (grimp and import-linter) on every fixture that has a helper-out.json and requires the output to
 * equal it. `pipx install import-linter && npm run test:tools`. HEALTH_UPDATE_FIXTURES=1 rewrites the files instead.
 */
const FIXTURES = ['d3-django', 'd3-fastapi', 'd3-generic-py', 'd3-declared-py', 'd3-na-py', 'd3-domain-py', 'd3-mixed', 'd3-mixed-py'];

function recording(real: ToolKit, seen: Record<string, HelperOutput>): ToolKit {
  return {
    ...real,
    async run(tool, args, opts) {
      const result = await real.run(tool, args, opts);
      const input = JSON.parse(readFileSync(args[1] as string, 'utf8')) as { roots: { dir: string; name: string }[] };
      seen[outKey(input)] = normalizeHelperOut(JSON.parse(readFileSync(args[3] as string, 'utf8')) as HelperOutput);
      return result;
    },
  };
}

describe.skipIf(!process.env.HEALTH_TOOLS)('real import-linter and grimp', () => {
  it.each(FIXTURES)('%s: the helper output equals helper-out.json', async (name) => {
    const seen: Record<string, HelperOutput> = {};
    const kit = recording(createToolKit(), seen);
    const ctx = await d3Context(materializeFixture(name), kit as never);
    const result = await getD3Graph(ctx('3.2'));
    if ('unavailable' in result) throw new Error(result.unavailable);
    const file = path.join(fixturesDir, name, 'helper-out.json');
    if (process.env.HEALTH_UPDATE_FIXTURES) {
      writeFileSync(file, `${JSON.stringify(seen, null, 2)}\n`);
      return;
    }
    const want = Object.fromEntries(Object.entries(readHelperOuts(name)).map(([key, out]) => [key, normalizeHelperOut(out)]));
    expect(seen).toEqual(want);
  });
});
