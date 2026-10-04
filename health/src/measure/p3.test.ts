import { describe, expect, it } from 'vitest';
import { graph, rules, seededContext } from '../../test/helpers/d3-facts.js';
import { measure } from '../../test/helpers/d3.js';
import { edgeKey } from './d3/types.js';
import type { Measurement } from './types.js';

function raws(m: Measurement): unknown[] {
  if (m.status !== 'measured') throw new Error(JSON.stringify(m));
  return m.units.map((u) => [u.package, u.weight, u.raw]);
}

describe('3.1', () => {
  it('is the level of each unit, weighted by logic lines', async () => {
    const ctx = await seededContext({ rules: [rules({ package: 'a', weight: 10, level31: 'enforced' }), rules({ package: 'b', weight: 5 })] });
    expect(raws(await measure(ctx, '3.1'))).toEqual([
      ['a', 10, { kind: 'level', level: 'enforced' }],
      ['b', 5, { kind: 'level', level: 'none' }],
    ]);
  });
});

describe('3.2', () => {
  it('divides violating edges by internal edges of non-test importers, per 1,000', async () => {
    const edge = (from: string, to: string, fromTest = false) => ({ from, to, fromTest, runtime: true });
    const g = graph({
      edges: [edge('a', 'b'), edge('b', 'c'), edge('t', 'a', true)],
      violating: [edgeKey('a', 'b'), edgeKey('a', 'express')],
    });
    expect(raws(await measure(await seededContext({ graphs: [g] }), '3.2'))).toEqual([['.', 100, { kind: 'ratio', numerator: 2, denominator: 2, scale: 1000 }]]);
  });

  it('is not_measured when the graph is unavailable', async () => {
    const result = await measure(await seededContext({ unavailable: 'dependency-cruiser failed: x' }), '3.2');
    expect(result).toEqual({ status: 'not_measured', reason: 'dependency-cruiser failed: x' });
  });
});

describe('3.3', () => {
  const edge = (from: string, to: string, runtime = true, fromTest = false) => ({ from, to, fromTest, runtime });

  it('counts logic files in a strongly connected component of runtime edges, across units', async () => {
    const a = graph({ package: 'a', logicFiles: ['a/1', 'a/2', 'a/3'], edges: [edge('a/1', 'b/1'), edge('a/3', 'a/2')] });
    const b = graph({ package: 'b', logicFiles: ['b/1'], edges: [edge('b/1', 'a/1')] });
    expect(raws(await measure(await seededContext({ graphs: [a, b] }), '3.3'))).toEqual([
      ['a', 100, { kind: 'ratio', numerator: 1, denominator: 3, scale: 100 }],
      ['b', 100, { kind: 'ratio', numerator: 1, denominator: 1, scale: 100 }],
    ]);
  });

  it('ignores type-only and dynamic edges and edges from test files', async () => {
    const g = graph({ logicFiles: ['x', 'y'], edges: [edge('x', 'y'), edge('y', 'x', false), edge('y', 'x', true, true)] });
    expect(raws(await measure(await seededContext({ graphs: [g] }), '3.3'))).toEqual([['.', 100, { kind: 'ratio', numerator: 0, denominator: 2, scale: 100 }]]);
  });
});

describe('3.4', () => {
  it('is entry crossings over all crossings of units with two modules, and not applicable without any', async () => {
    const two = graph({ package: 'a', moduleCount: 2, crossings: [{ from: 'x', to: 'y', toEntry: true }, { from: 'x', to: 'z', toEntry: false }] });
    const one = graph({ package: 'b', moduleCount: 1 });
    expect(raws(await measure(await seededContext({ graphs: [two, one] }), '3.4'))).toEqual([['a', 100, { kind: 'ratio', numerator: 1, denominator: 2, scale: 100 }]]);
    const na = await measure(await seededContext({ graphs: [one] }), '3.4');
    expect(na.status).toBe('not_applicable');
  });

  it('a unit with two modules and no crossings is 0 over 0', async () => {
    const g = graph({ moduleCount: 2 });
    expect(raws(await measure(await seededContext({ graphs: [g] }), '3.4'))).toEqual([['.', 100, { kind: 'ratio', numerator: 0, denominator: 0, scale: 100 }]]);
  });
});

describe('3.5', () => {
  it('is impure over domain files, and a unit without domain files emits nothing', async () => {
    const g = graph({ package: 'a', domain: { files: ['d/1', 'd/2'], impure: ['d/1'] } });
    expect(raws(await measure(await seededContext({ graphs: [g, graph({ package: 'b' })] }), '3.5'))).toEqual([
      ['a', 100, { kind: 'ratio', numerator: 1, denominator: 2, scale: 100 }],
    ]);
    expect((await measure(await seededContext({ graphs: [graph()] }), '3.5')).status).toBe('not_applicable');
  });
});
