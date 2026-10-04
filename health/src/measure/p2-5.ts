import { measureFindings } from '../exec/findings.js';
import type { Measurer } from './types.js';

export const p25: Measurer = {
  id: '2.5',
  layer: 'execution',
  async measure(ctx) {
    return measureFindings(ctx, (exec) => exec.lint);
  },
};
