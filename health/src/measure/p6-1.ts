import type { RootResult } from '../exec/types.js';
import type { Measurer } from './types.js';

/** install_fails when the install did not work; build_fails when it did and the build did not; works otherwise (no build step counts as works). */
function installLevel(root: RootResult): 'install_fails' | 'build_fails' | 'works' {
  if (root.install && root.install.status !== 'ok') return 'install_fails';
  if (root.build && root.build.status !== 'ok') return 'build_fails';
  return 'works';
}

export const p61: Measurer = {
  id: '6.1',
  layer: 'execution',
  async measure({ exec }) {
    if (!exec) return { status: 'not_measured', reason: 'execution layer did not run' };
    return {
      status: 'measured',
      units: exec.roots.map((root) => ({ package: root.dir, group: root.group, weight: root.weight, raw: { kind: 'level' as const, level: installLevel(root) } })),
    };
  },
};
