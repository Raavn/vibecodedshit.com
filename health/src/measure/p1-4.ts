import { PyImportGraph } from './safety/py-tests.js';
import { TsCredits } from './safety/ts-credits.js';
import { createTsResolver } from './safety/ts-resolve.js';
import { logicUnits } from './units.js';
import type { Measurer } from './types.js';

export const p14: Measurer = {
  id: '1.4',
  layer: 'static',
  async measure({ scope, repoPath }) {
    const units = logicUnits(scope);
    const warnings: string[] = [];
    const credited = new Set<string>();

    const tsTests = scope.files.filter((f) => f.role === 'test' && f.group === 'typescript_javascript');
    if (tsTests.length > 0 && units.some((u) => u.group === 'typescript_javascript')) {
      const credits = new TsCredits(repoPath, scope, createTsResolver(repoPath));
      for (const test of tsTests) for (const file of credits.credits(test.path)) credited.add(file);
    }

    const pyFiles = scope.files.filter((f) => f.group === 'python');
    const pyTests = pyFiles.filter((f) => f.role === 'test');
    if (pyTests.length > 0 && units.some((u) => u.group === 'python')) {
      const graph = new PyImportGraph(repoPath, pyFiles);
      for (const test of pyTests) {
        if (graph.factsOf(test.path)?.ok === false) warnings.push(`1.4: ${test.path}: syntax error, its imports are not counted`);
        for (const file of graph.credits(test.path)) credited.add(file);
      }
    }

    return {
      status: 'measured',
      units: units.map((unit) => ({
        package: unit.package,
        group: unit.group,
        weight: unit.weight,
        raw: { kind: 'ratio' as const, numerator: unit.files.filter((f) => credited.has(f.path)).length, denominator: unit.files.length, scale: 100 },
      })),
      ...(warnings.length === 0 ? {} : { warnings }),
    };
  },
};
