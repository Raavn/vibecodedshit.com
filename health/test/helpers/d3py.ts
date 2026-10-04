import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HelperOutput } from '../../src/measure/d3/py/graph.js';
import { fixturesDir } from './fixture.js';
import { ok, type FakeTool } from './tools.js';

interface HelperInput {
  roots: { dir: string; name: string }[];
}

/** helper-out.json holds one helper output per unit, keyed by the unit's root packages (`app`, `src/app,src/lib`). */
export function outKey(input: HelperInput): string {
  return input.roots.map((r) => (r.dir === '.' ? r.name : `${r.dir}/${r.name}`)).join(',');
}

export function readHelperOuts(fixture: string, file = 'helper-out.json'): Record<string, HelperOutput> {
  return JSON.parse(readFileSync(path.join(fixturesDir, fixture, file), 'utf8')) as Record<string, HelperOutput>;
}

/** An import-linter fake that answers with the fixture's hand-written helper output (a `[fixture]` override replaces keys). */
export function fakeGraphHelper(fixture: string, override: Record<string, HelperOutput> = {}): FakeTool {
  const outs = { ...readHelperOuts(fixture), ...override };
  return (args) => {
    const input = JSON.parse(readFileSync(args[1] as string, 'utf8')) as HelperInput;
    const out = outs[outKey(input)];
    if (out === undefined) throw new Error(`${fixture}/helper-out.json has no entry for ${outKey(input)}`);
    writeFileSync(args[3] as string, JSON.stringify(out));
    return ok();
  };
}

/** The comparable form of a helper output: sorted, without versions. */
export function normalizeHelperOut(out: HelperOutput): HelperOutput {
  const byJson = (a: unknown, b: unknown): number => JSON.stringify(a).localeCompare(JSON.stringify(b));
  return {
    emptied: [...(out.emptied ?? [])].sort(),
    edges: (out.edges ?? []).map((e) => ({ ...e, lines: [...e.lines].sort((x, y) => x - y) })).sort(byJson),
    violations: [...(out.violations ?? [])].sort(byJson),
    skipped: [...(out.skipped ?? [])].sort(byJson),
  };
}
