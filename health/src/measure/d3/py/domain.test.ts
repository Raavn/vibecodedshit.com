import { describe, expect, it } from 'vitest';
import { loadMethodology } from '../../../methodology/load.js';
import type { PythonImportsInfo } from '../../../python/imports.js';
import { declaredDomainModules, domainFilesOf, isImpure } from './domain.js';

const lists = loadMethodology('1.0').d3;
const info = (over: Partial<PythonImportsInfo> = {}, ...modules: { m: string; level?: number }[]): PythonImportsInfo => ({
  syntaxError: false,
  opensBuiltin: false,
  imports: modules.map((x, i) => ({ line: i + 1, level: x.level ?? 0, modules: [x.m], lazy: false, typeOnly: false })),
  ...over,
});

describe('isImpure', () => {
  it('matches the first dotted name of a forbidden package, never a relative import', () => {
    expect(isImpure(info({}, { m: 'psycopg2.extras' }), [], lists)).toBe(true);
    expect(isImpure(info({}, { m: 'requests.adapters' }), [], lists)).toBe(true);
    expect(isImpure(info({}, { m: 'requestsx' }), [], lists)).toBe(false);
    expect(isImpure(info({}, { m: 'django', level: 1 }), [], lists)).toBe(false);
  });

  it('counts a lazy or type-only import and an infrastructure directory unless it is under domain', () => {
    const lazy: PythonImportsInfo = { syntaxError: false, opensBuiltin: false, imports: [{ line: 1, level: 0, modules: ['redis'], lazy: true, typeOnly: true }] };
    expect(isImpure(lazy, [], lists)).toBe(true);
    expect(isImpure(info(), ['app/infra/c.py'], lists)).toBe(true);
    expect(isImpure(info(), ['app/domain/infra/c.py'], lists)).toBe(false);
    expect(isImpure(info(), ['app/service/c.py'], lists)).toBe(false);
  });

  it('counts a builtin open call', () => {
    expect(isImpure(info({ opensBuiltin: true }), [], lists)).toBe(true);
    expect(isImpure(undefined, [], lists)).toBe(false);
  });
});

describe('declaredDomainModules and domainFilesOf', () => {
  it('splits layer entries on | and :, prefixes containers and keeps only layers ending in domain', () => {
    const contracts = [
      { name: 'a', type: 'layers', layers: ['web | api', 'pkg.domain : other'], containers: [] },
      { name: 'b', type: 'layers', layers: ['domain', 'infra'], containers: ['one', 'two'] },
      { name: 'c', type: 'forbidden', layers: [], containers: [] },
    ];
    expect(declaredDomainModules(contracts)).toEqual(['pkg.domain', 'one.domain', 'two.domain']);
  });

  it('a file belongs to a module that equals or is a prefix of its dotted name', () => {
    const roots = [{ dir: '.', name: 'pkg' }];
    const files = ['pkg/domain/a.py', 'pkg/domain/sub/b.py', 'pkg/domainx.py', 'pkg/other.py', 'pkg/core/domain.py'];
    expect(domainFilesOf(files, roots, ['pkg.core.domain'])).toEqual(['pkg/domain/a.py', 'pkg/domain/sub/b.py', 'pkg/core/domain.py']);
    expect(domainFilesOf(files, roots, [])).toEqual(['pkg/domain/a.py', 'pkg/domain/sub/b.py']);
  });
});
