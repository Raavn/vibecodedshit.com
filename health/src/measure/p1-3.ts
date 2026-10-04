import { measureCoverage } from '../exec/tests.js';
import type { Measurer } from './types.js';

export const p13: Measurer = {
  id: '1.3',
  layer: 'execution',
  async measure(ctx) {
    return measureCoverage(ctx, 'branches');
  },
};
