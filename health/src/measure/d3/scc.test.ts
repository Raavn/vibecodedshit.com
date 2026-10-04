import { describe, expect, it } from 'vitest';
import { cyclicNodes } from './scc.js';

describe('cyclicNodes', () => {
  it('finds components of two or more nodes and ignores self loops', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'];
    const edges: [string, string][] = [['a', 'b'], ['b', 'a'], ['b', 'c'], ['c', 'c'], ['d', 'e']];
    expect([...cyclicNodes(nodes, edges)].sort()).toEqual(['a', 'b']);
  });

  it('handles a long chain without recursion', () => {
    const nodes = Array.from({ length: 50_000 }, (_, i) => `n${i}`);
    const edges = nodes.slice(1).map((n, i): [string, string] => [nodes[i] as string, n]);
    edges.push([nodes[nodes.length - 1] as string, nodes[0] as string]);
    expect(cyclicNodes(nodes, edges).size).toBe(50_000);
  });

  it('keeps separate components apart and drops edges to unknown nodes', () => {
    const edges: [string, string][] = [['a', 'b'], ['b', 'a'], ['c', 'd'], ['d', 'c'], ['a', 'zzz']];
    expect([...cyclicNodes(['a', 'b', 'c', 'd'], edges)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
