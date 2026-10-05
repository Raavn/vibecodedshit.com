import { measureCoverage } from '../exec/tests.js';
import type { Measurer } from './types.js';

export const p12: Measurer = {
  id: '1.2',
  layer: 'execution',
  async measure(ctx) {
    return measureCoverage(ctx, 'lines');
  },
};
