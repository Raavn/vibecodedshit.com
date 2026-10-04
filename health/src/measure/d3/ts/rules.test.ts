import { describe, expect, it } from 'vitest';
import { packagesToRegex, pathsToRegex, presetRules } from './rules.js';

describe('pathsToRegex', () => {
  const paths = ['src/a.ts', 'src/a/b.ts', 'src/a/c.d.ts', 'src/lib/x.ts', 'index.ts'];
  const re = new RegExp(pathsToRegex(paths));

  it('matches exactly the listed files, a file that is also a directory name included', () => {
    for (const p of paths) expect(re.test(p)).toBe(true);
    for (const p of ['src/a', 'src/a.tsx', 'src/lib', 'src/lib/x.tsx', 'xsrc/a.ts', 'src/a/c.dxts', 'src/a/']) expect(re.test(p)).toBe(false);
  });

  it('is linear in the number of files', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => `src/dir${i % 100}/file${i}.ts`);
    expect(pathsToRegex(many).length).toBeLessThan(many.join('').length * 2);
  });
});

describe('packagesToRegex', () => {
  it('matches the package and anything below it, not a longer name', () => {
    const re = new RegExp(packagesToRegex(['express', '@prisma/client']));
    expect(['express', 'express/lib', '@prisma/client'].every((p) => re.test(p))).toBe(true);
    expect(['expressive', 'my-express'].some((p) => re.test(p))).toBe(false);
  });
});

describe('presetRules', () => {
  const layers = new Map([['http', new Set(['r.ts'])], ['services', new Set(['s.ts'])]]);
  const rule = (over = {}) => ({
    name: 'r', from: { in: ['services'] }, to: { in: ['http'], packages: ['express'] },
    severity: 'error' as const, type_only_imports: 'included' as const, ...over,
  });

  it('makes one rule per to alternative, named by package and rule', () => {
    const { rules, meta } = presetRules('pkg', [rule()], layers, ['r.ts', 's.ts', 'o.ts']);
    expect(rules.map((r) => r.name)).toEqual(['pkg:r', 'pkg:r#packages']);
    expect(meta.get('pkg:r#packages')).toEqual({ rule: 'r', excludesTypeOnly: false });
  });

  it('from.not_in is every file in none of the listed layers, and info rules are skipped', () => {
    const { rules } = presetRules('pkg', [rule({ from: { not_in: ['http'] }, to: { in: ['http'] } }), rule({ name: 'i', severity: 'info' })], layers, ['r.ts', 's.ts', 'o.ts']);
    expect(rules).toHaveLength(1);
    const from = new RegExp(rules[0]?.from.path as string);
    expect(['s.ts', 'o.ts'].every((f) => from.test(f))).toBe(true);
    expect(from.test('r.ts')).toBe(false);
  });
});
