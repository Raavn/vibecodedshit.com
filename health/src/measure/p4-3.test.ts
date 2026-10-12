import { describe, expect, it } from 'vitest';
import { attributeClones, type Clone } from './p4-3.js';

const clone = (first: string, second: string, start = 2, end = 11): Clone => ({
  firstFile: { name: first, start, end },
  secondFile: { name: second, start: start + 3, end: end + 3 },
});
const identity = (name: string): string => name;

describe('4.3 clone attribution', () => {
  it('counts each clone once, on its firstFile', () => {
    const inScope = (file: string): boolean => ['a.ts', 'b.ts', 'c.ts'].includes(file);
    const byFile = attributeClones([clone('a.ts', 'b.ts'), clone('a.ts', 'c.ts')], inScope, identity);
    expect(Object.fromEntries(byFile ?? [])).toEqual({ 'a.ts': 20 });
  });

  it('falls back to secondFile when firstFile is out of scope', () => {
    const inScope = (file: string): boolean => file === 'src/b.ts';
    const byFile = attributeClones([clone('vendor/a.ts', 'src/b.ts', 1, 6)], inScope, identity);
    // secondFile covers lines 4 to 9.
    expect(Object.fromEntries(byFile ?? [])).toEqual({ 'src/b.ts': 6 });
  });

  it('drops a clone with neither file in scope', () => {
    expect(attributeClones([clone('x.ts', 'y.ts')], () => false, identity)?.size).toBe(0);
  });

  it('returns null for a malformed clone', () => {
    expect(attributeClones([{ firstFile: { name: 'a.ts' } }], () => true, identity)).toBeNull();
  });
});
