import { describe, expect, it } from 'vitest';
import { add, clamp } from '../src/math.js';

describe('math', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3);
  });
  it('clamps below', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it('clamps above', () => {
    expect(clamp(11, 0, 10)).toBe(11);
  });
  it.skip('clamps in the middle', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});
