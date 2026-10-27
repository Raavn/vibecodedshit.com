import { describe, expect, it } from 'vitest';
import { loadMethodology } from '../src/methodology/load.js';
import { buildRoadmap, gainText, roadmapLines, targetDescriptor } from '../src/report/roadmap.js';
import type { RunParameter } from '../src/run/schema.js';
import { makeRun } from './helpers/run.js';

const methodology = loadMethodology('1.0');
const defs = methodology.dimensions.flatMap((d) => d.parameters);
const def = (id: string) => {
  const found = defs.find((p) => p.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};
const measured = (id: string, score: number): RunParameter => ({ id, status: 'measured', weight: def(id).weight, score });

describe('roadmap: Gain', () => {
  it('is 0 for everything but the weakest dimension when the cap binds', () => {
    // Dimensions 10, 80 x5: health = min(68.3, 10 + 30) = 40. Only lifting 1.1 moves the min.
    const run = makeRun({
      scores: [10, 80, 80, 80, 80, 80],
      parameters: [measured('1.1', 10), measured('2.1', 80), measured('3.1', 80), measured('4.1', 80), measured('5.1', 80), measured('6.1', 80)],
    });
    expect(run.health?.displayed).toBe(40);
    const items = buildRoadmap(run, methodology);
    // 1.1 to 100: dimensions 100, 80 x5, mean 83.3, min + 30 = 110, health 83, Gain 43.
    expect(items[0]).toMatchObject({ id: '1.1', gain: 43 });
    expect(items.slice(1).map((i) => i.gain)).toEqual([0, 0, 0, 0, 0]);
    expect(items.map((i) => i.id)).toEqual(['1.1', '2.1', '3.1', '4.1', '5.1', '6.1']);
  });

  it('counts a failed parameter as 0 and orders by Gain, then precise Gain', () => {
    // Dimension 1: 1.1 failed (0, weight 20) and 1.2 at 50 (weight 25) = 27.78. Others 70. Health = min(63.0, 57.8) = 58.
    const run = makeRun({
      scores: [(0 * 20 + 50 * 25) / 45, 70, 70, 70, 70, 70],
      parameters: [
        { id: '1.1', status: 'failed', weight: 20 },
        measured('1.2', 50),
        measured('2.1', 70),
        measured('3.1', 70),
        measured('4.1', 70),
        measured('5.1', 70),
        measured('6.1', 70),
      ],
    });
    expect(run.health?.displayed).toBe(58);
    const items = buildRoadmap(run, methodology);
    // 1.1 to 100: dimension 1 = 72.2, health = min(70.4, 100) = 70, Gain 12. 1.2 to 100: 55.6, min(67.6, 85.6) = 68, Gain 10.
    expect(items.slice(0, 2).map((i) => [i.id, i.gain])).toEqual([['1.1', 12], ['1.2', 10]]);
    expect(items[0]?.raw).toBeNull();
    expect(items[0]?.score).toBe(0);
    expect(items.slice(2).every((i) => i.gain === 0)).toBe(true);
  });

  it('lists nothing for parameters at 100, not applicable or not measured, and nothing without a health score', () => {
    const run = makeRun({
      scores: [100, 60, 60, 60, 60, 60],
      parameters: [measured('1.1', 100), { id: '1.2', status: 'not_applicable', weight: 25 }, { id: '2.1', status: 'not_measured', weight: 25 }, measured('3.1', 60)],
    });
    expect(buildRoadmap(run, methodology).map((i) => i.id)).toEqual(['3.1']);
    expect(buildRoadmap(makeRun({ health: null }), methodology)).toEqual([]);
  });

  it('caps the list at 10', () => {
    const run = makeRun({ scores: [50, 50, 50, 50, 50, 50], parameters: defs.map((d) => measured(d.id, 50)) });
    expect(buildRoadmap(run, methodology)).toHaveLength(10);
  });

  it('prints a zero Gain as no gain', () => {
    expect(gainText(4)).toBe('+4');
    expect(gainText(0)).toBe('+0 · no gain');
  });
});

describe('roadmap: next anchor', () => {
  it('quotes the descriptor of the next anchor above the score', () => {
    expect(targetDescriptor(def('4.1'), 70)).toBe('A few hard functions.');
    expect(targetDescriptor(def('4.1'), 75)).toBe('Every function can be read in one pass.');
    expect(targetDescriptor(def('4.1'), 100)).toBeNull();
    expect(targetDescriptor(def('6.5'), 50)).toBeNull();
  });
});

describe('roadmap: stdout lines', () => {
  it('gives up to 3 lines ranked by Gain', () => {
    const run = makeRun({ scores: [50, 50, 50, 50, 50, 50], parameters: defs.map((d) => measured(d.id, 50)) });
    const lines = roadmapLines(run, methodology);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^1\. \d\.\d .+ \(.+\) (\+\d+|\+0 · no gain)( — .+)?$/);
    expect(lines[2]?.startsWith('3. ')).toBe(true);
  });

  it('gives none without a health score', () => {
    expect(roadmapLines(makeRun({ health: null }), methodology)).toEqual([]);
  });
});
