import type { Step } from '../types.js';

const KNIP_CONFIG = '/opt/health/knip.json';

/**
 * Knip in the installed work copy, for 4.4 and 5.5. The repository's own knip config is not used
 * (an empty config baked into the image), framework plugins stay enabled. DOTENV_CONFIG_QUIET keeps
 * dotenv 17 from printing its banner into the report. Network off.
 */
export const knip: Step = {
  name: 'knip',
  network: false,
  command() {
    return {
      argv: [
        'health-capture',
        '/out/knip.json',
        'env',
        'DOTENV_CONFIG_QUIET=true',
        'knip',
        '--reporter',
        'json',
        '--no-progress',
        '--no-config-hints',
        '--config',
        KNIP_CONFIG,
      ],
      report: 'knip.json',
    };
  },
};
