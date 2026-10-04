import { describe, expect, it } from 'vitest';
import { presetContracts } from './contracts.js';

const roots = [{ dir: 'src', name: 'app' }];
const files = ['src/app/shared/a.py', 'src/app/features/b.py', 'src/app/features/__init__.py', 'src/app/bad-name.py', 'tool.py'];
const layerFiles = new Map([
  ['shared', new Set(['src/app/shared/a.py'])],
  ['features', new Set(['src/app/features/b.py', 'src/app/features/__init__.py'])],
]);

describe('presetContracts', () => {
  it('names contracts, maps files to module names and uses string booleans', () => {
    const { contracts, meta } = presetContracts('.', [{ name: 'r', from: { in: ['shared'] }, to: { in: ['features'] }, severity: 'error', type_only_imports: 'included' }], layerFiles, files, roots);
    expect(contracts).toEqual([
      {
        id: '.:r',
        name: '.:r',
        type: 'forbidden',
        source_modules: ['app.shared.a'],
        forbidden_modules: ['app.features', 'app.features.b'],
        as_packages: 'false',
        allow_indirect_imports: 'true',
        unmatched_ignore_imports_alerting: 'none',
      },
    ]);
    expect(meta.get('.:r')).toEqual({ rule: 'r', excludesTypeOnly: false });
  });

  it('builds not_in sources from the unit files, skips info rules, empty lists and files outside a root package', () => {
    const rules = [
      { name: 'leaf', from: { not_in: ['shared'] }, to: { in: ['shared'], packages: ['fastapi'] }, severity: 'warn' as const, type_only_imports: 'excluded' as const },
      { name: 'noise', from: { in: ['shared'] }, to: { in: ['features'] }, severity: 'info' as const, type_only_imports: 'included' as const },
      { name: 'empty', from: { in: ['missing'] }, to: { in: ['shared'] }, severity: 'error' as const, type_only_imports: 'included' as const },
    ];
    const { contracts, meta } = presetContracts('svc', rules, layerFiles, files, roots);
    expect(contracts.map((c) => [c.name, c.source_modules, c.forbidden_modules])).toEqual([
      ['svc:leaf', ['app.features', 'app.features.b'], ['app.shared.a']],
      ['svc:leaf#packages', ['app.features', 'app.features.b'], ['fastapi']],
    ]);
    expect(meta.get('svc:leaf#packages')).toEqual({ rule: 'leaf', excludesTypeOnly: true });
  });
});
