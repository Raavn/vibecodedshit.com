import { describe, expect, it } from 'vitest';
import { moduleName, pythonRoots, rootOf } from './roots.js';

const roots = (unit: string, files: string[], tracked: string[] = [], warnings: string[] = []) => pythonRoots(unit, files, new Set(tracked), warnings);

describe('pythonRoots', () => {
  it('takes identifier-named child directories of the unit, with or without __init__.py', () => {
    expect(roots('.', ['app/a.py', 'ns/b/c.py', 'main.py', 'not-valid/x.py', '2fast/y.py'])).toEqual([
      { dir: '.', name: 'app' },
      { dir: '.', name: 'ns' },
    ]);
  });

  it('uses src/ as a source root when it holds files and has no __init__.py, and does not treat src as a package', () => {
    expect(roots('.', ['src/app/a.py', 'other/b.py'])).toEqual([
      { dir: 'src', name: 'app' },
      { dir: '.', name: 'other' },
    ]);
  });

  it('treats src as a package when it has __init__.py', () => {
    expect(roots('.', ['src/a.py'], ['src/__init__.py'])).toEqual([{ dir: '.', name: 'src' }]);
  });

  it('works inside a workspace package and lets src win on a name clash with a warning', () => {
    const warnings: string[] = [];
    expect(roots('svc', ['svc/src/app/a.py', 'svc/app/b.py'], [], warnings)).toEqual([{ dir: 'svc/src', name: 'app' }]);
    expect(warnings).toEqual(['svc/src/app and svc/app share the package name app, the src one is used']);
  });

  it('single-file top-level modules are not packages', () => {
    expect(roots('.', ['manage.py', 'settings.py'])).toEqual([]);
  });
});

describe('moduleName and rootOf', () => {
  it('maps files to dotted names and drops __init__', () => {
    const root = { dir: 'src', name: 'app' };
    expect(moduleName(root, 'src/app/a/b.py')).toBe('app.a.b');
    expect(moduleName(root, 'src/app/a/__init__.py')).toBe('app.a');
    expect(moduleName(root, 'src/app/__init__.py')).toBe('app');
    expect(moduleName(root, 'src/app/bad-name.py')).toBeUndefined();
    expect(moduleName(root, 'src/other/a.py')).toBeUndefined();
    expect(rootOf([root, { dir: '.', name: 'lib' }], 'lib/x.py')).toEqual({ dir: '.', name: 'lib' });
  });
});
