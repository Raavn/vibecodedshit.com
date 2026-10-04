import { describe, expect, it } from 'vitest';
import { loadMethodology } from '../../methodology/load.js';
import { choosePreset, globLayers, moduleDirs, publicEntryGlob } from './presets.js';

const methodology = loadMethodology('1.0');

describe('choosePreset', () => {
  it('takes the first candidate in detection order and falls back to generic', () => {
    expect(choosePreset(methodology, 'typescript_javascript', { nextjs: true, express: true }).preset).toBe('nextjs');
    expect(choosePreset(methodology, 'typescript_javascript', { express: true }).preset).toBe('express');
    expect(choosePreset(methodology, 'typescript_javascript', {}).preset).toBe('generic');
  });

  it('only considers presets whose languages include the group', () => {
    expect(choosePreset(methodology, 'typescript_javascript', { django: true, fastapi: true }).preset).toBe('generic');
    expect(choosePreset(methodology, 'python', { nextjs: true, django: true }).preset).toBe('django');
  });

  it('loads every preset of the dimension file', () => {
    expect(Object.keys(methodology.presets).sort()).toEqual(['django', 'express', 'fastapi', 'generic', 'nextjs']);
    expect(methodology.presets.nextjs?.rules.map((r) => r.name)).toContain('client-does-not-import-server');
  });
});

describe('globLayers', () => {
  const layers = { routes: ['app/**', 'pages/**'], lib: ['lib/**'], prose: 'content layer' };

  it('matches with or without a src/ prefix and skips prose layers', () => {
    const result = globLayers(layers, ['app/page.tsx', 'src/app/x/y.tsx', 'src/lib/a.ts', 'lib/b.ts', 'other/c.ts']);
    expect([...result]).toEqual([['app/page.tsx', 'routes'], ['src/app/x/y.tsx', 'routes'], ['src/lib/a.ts', 'lib'], ['lib/b.ts', 'lib']]);
  });

  it('gives a file in several layers to the longest matching directory prefix, ties to the first listed', () => {
    const nested = { broad: ['app/**'], narrow: ['app/api/**'], tie1: ['app/z/**'], tie2: ['app/z/**'] };
    const result = globLayers(nested, ['app/page.tsx', 'app/api/route.ts', 'app/z/q.ts']);
    expect(result.get('app/page.tsx')).toBe('broad');
    expect(result.get('app/api/route.ts')).toBe('narrow');
    expect(result.get('app/z/q.ts')).toBe('tie1');
  });
});

describe('moduleDirs and publicEntryGlob', () => {
  it('assigns a file to the deepest module directory and leaves others in no module', () => {
    const result = moduleDirs(['features/*', 'packages/*'], ['src/features/billing/charge.ts', 'features/users/deep/x.ts', 'src/lib/a.ts', 'features/top.ts']);
    expect(result.get('src/features/billing/charge.ts')).toBe('src/features/billing');
    expect(result.get('features/users/deep/x.ts')).toBe('features/users');
    expect(result.get('src/lib/a.ts')).toBeUndefined();
    expect(result.get('features/top.ts')).toBeUndefined();
  });

  it('reads the entry glob for the group', () => {
    expect(publicEntryGlob(methodology.presets.generic!, 'typescript_javascript')).toBe('index.{ts,tsx,js,jsx,mts,mjs,cjs}');
    expect(publicEntryGlob(methodology.presets.express!, 'typescript_javascript')).toBe('index.{ts,js,mts,mjs,cjs}');
  });
});

describe('prefixes', () => {
  it('Python passes its root package directories instead of src/, TypeScript keeps both defaults', () => {
    const layers = { shared: ['shared/**'] };
    expect([...globLayers(layers, ['src/shared/a.py', 'pkg/shared/b.py', 'shared/c.py'], ['', 'pkg/'])]).toEqual([['pkg/shared/b.py', 'shared'], ['shared/c.py', 'shared']]);
    expect([...globLayers(layers, ['src/shared/a.ts', 'pkg/shared/b.ts', 'shared/c.ts'])]).toEqual([['src/shared/a.ts', 'shared'], ['shared/c.ts', 'shared']]);
    expect(moduleDirs(['features/*'], ['pkg/features/x/a.py'], ['', 'pkg/']).get('pkg/features/x/a.py')).toBe('pkg/features/x');
  });
});
