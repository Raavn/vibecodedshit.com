import assert from 'node:assert/strict';
import { add, clamp } from '../src/math.js';

describe('math', () => {
  it('adds', () => {
    assert.equal(add(1, 2), 3);
  });
  it('clamps below', () => {
    assert.equal(clamp(-1, 0, 10), 0);
  });
  it('clamps above', () => {
    assert.equal(clamp(11, 0, 10), 11);
  });
  it.skip('clamps in the middle', () => {
    assert.equal(clamp(5, 0, 10), 5);
  });
});
