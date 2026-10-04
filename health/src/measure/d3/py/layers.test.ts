import { describe, expect, it } from 'vitest';
import { loadMethodology } from '../../../methodology/load.js';
import type { Preset } from '../../../methodology/schema.js';
import { classifyPython } from './layers.js';
import { pythonRoots } from './roots.js';

const methodology = loadMethodology('1.0');
const preset = (key: 'django' | 'fastapi' | 'generic'): Preset => methodology.presets[key] as Preset;

function classify(key: 'django' | 'fastapi' | 'generic', files: string[], tracked: string[] = [], unit = '.') {
  const roots = pythonRoots(unit, files, new Set(tracked), []);
  return classifyPython(preset(key), files, unit, roots, new Set([...tracked, ...files]));
}

describe('django', () => {
  const files = [
    'shop/apps.py', 'shop/__init__.py', 'shop/models.py', 'shop/views.py', 'shop/views/user.py', 'shop/urls.py', 'shop/admin.py',
    'shop/services/__init__.py', 'shop/services/cart.py', 'shop/selectors.py', 'shop/utils.py', 'config/urls.py',
  ];
  const c = classify('django', files);

  it('puts a file in every layer whose list holds its key (views is in http and views)', () => {
    expect(c.layers.get('shop/views.py')).toEqual(['http', 'views']);
    expect(c.layers.get('shop/views/user.py')).toEqual(['http', 'views']);
    expect(c.layers.get('shop/urls.py')).toEqual(['http', 'urls']);
    expect(c.layers.get('shop/admin.py')).toEqual(['http']);
    expect(c.layers.get('shop/services/cart.py')).toEqual(['services']);
    expect(c.layers.get('shop/selectors.py')).toEqual(['services']);
    expect(c.layers.get('shop/utils.py')).toBeUndefined();
    expect(c.layers.get('config/urls.py')).toBeUndefined();
  });

  it('modules are apps (directories with apps.py); files outside an app have none', () => {
    expect(c.moduleOf.get('shop/models.py')).toBe('shop');
    expect(c.moduleOf.get('shop/services/cart.py')).toBe('shop');
    expect(c.moduleOf.has('config/urls.py')).toBe(false);
  });

  it('entries are __init__.py and every file of models, services and selectors', () => {
    expect([...c.entries].sort()).toEqual(['shop/__init__.py', 'shop/models.py', 'shop/selectors.py', 'shop/services/__init__.py', 'shop/services/cart.py']);
  });

  it('layer modules separate views.py from views/ files only by their key', () => {
    expect(c.layerModule.get('shop/views.py')).toBe('shop/views');
    expect(c.layerModule.get('shop/views/user.py')).toBe('shop/views');
    expect(c.layerModule.get('shop/models.py')).toBe('shop/models');
  });

  it('the deepest app wins', () => {
    const nested = classify('django', ['shop/apps.py', 'shop/inner/apps.py', 'shop/inner/models.py', 'shop/models.py']);
    expect(nested.moduleOf.get('shop/inner/models.py')).toBe('shop/inner');
    expect(nested.moduleOf.get('shop/models.py')).toBe('shop');
  });
});

describe('fastapi', () => {
  const files = [
    'app/main.py', 'app/api/routes/users.py', 'app/services/user_service.py', 'app/services/db.py', 'app/models/user.py', 'app/schemas.py',
    'app/users/router.py', 'app/users/__init__.py', 'app/users/service.py', 'app/features/billing/__init__.py', 'app/features/billing/charge.py',
    'app/features/billing/deep/x.py', 'app/router.py', 'app/api/routers/services/y.py',
  ];
  const c = classify('fastapi', files);

  it('the innermost matching segment decides the layer; the root package name is not matched', () => {
    expect(c.layers.get('app/main.py')).toEqual(['app_entry']);
    expect(c.layers.get('app/api/routes/users.py')).toEqual(['http']);
    expect(c.layers.get('app/services/db.py')).toEqual(['data']);
    expect(c.layers.get('app/services/user_service.py')).toEqual(['services']);
    expect(c.layers.get('app/models/user.py')).toEqual(['data']);
    expect(c.layers.get('app/schemas.py')).toEqual(['schemas']);
    expect(c.layers.get('app/api/routers/services/y.py')).toEqual(['services']);
    expect(c.layers.get('app/users/service.py')).toEqual(['services']);
  });

  it('modules hold router.py or are direct children of features/modules; the root package itself is not one', () => {
    expect(c.moduleOf.get('app/users/router.py')).toBe('app/users');
    expect(c.moduleOf.get('app/features/billing/charge.py')).toBe('app/features/billing');
    expect(c.moduleOf.get('app/features/billing/deep/x.py')).toBe('app/features/billing');
    expect(c.moduleOf.has('app/router.py')).toBe(false);
    expect(c.moduleOf.has('app/main.py')).toBe(false);
  });

  it('the entry is __init__.py directly in the module directory', () => {
    expect([...c.entries].sort()).toEqual(['app/features/billing/__init__.py', 'app/users/__init__.py']);
  });
});

describe('generic', () => {
  it('matches layer and module globs with the root package directories as prefixes (flat and src layouts)', () => {
    for (const root of ['pkg', 'src/pkg']) {
      const files = [`${root}/shared/a.py`, `${root}/features/cart/__init__.py`, `${root}/features/cart/cart.py`, `${root}/modules/x/y.py`, `${root}/other.py`];
      const c = classify('generic', files);
      expect(c.layers.get(files[0] as string)).toEqual(['shared']);
      expect(c.layers.get(files[2] as string)).toEqual(['features']);
      expect(c.layers.has(files[4] as string)).toBe(false);
      expect(c.moduleOf.get(files[2] as string)).toBe(`${root}/features/cart`);
      expect(c.moduleOf.get(files[3] as string)).toBe(`${root}/modules/x`);
      expect([...c.entries]).toEqual([files[1]]);
    }
  });

  it('works for a workspace package: globs are relative to the package directory', () => {
    const c = classify('generic', ['svc/app/shared/a.py', 'svc/app/features/cart/cart.py'], [], 'svc');
    expect(c.layers.get('svc/app/shared/a.py')).toEqual(['shared']);
    expect(c.moduleOf.get('svc/app/features/cart/cart.py')).toBe('svc/app/features/cart');
  });
});
