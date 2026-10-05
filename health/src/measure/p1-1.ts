import { measurePassRate } from '../exec/tests.js';
import type { Measurer } from './types.js';

export const p11: Measurer = {
  id: '1.1',
  layer: 'execution',
  async measure(ctx) {
    return measurePassRate(ctx);
  },
};
