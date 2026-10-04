import { describe, expect, it } from 'vitest';
import { materializeFixture } from '../../../../test/helpers/fixture.js';
import { resetTrackedCache } from '../../../scope/tracked.js';
import { findPyDeclared, type PyDeclared } from './config.js';
import { allTypeOnly, externalTypeOnly, isRuntime } from './graph.js';

function find(tracked: Record<string, string>, unit = '.') {
  resetTrackedCache();
  const repo = materializeFixture('d3-na-py', {}, tracked);
  const warnings: string[] = [];
  const declared: PyDeclared | undefined = findPyDeclared(repo, unit, warnings, new Map());
  return { declared, warnings };
}

describe('findPyDeclared', () => {
  it('reads INI contracts with multi-line layers and containers', () => {
    const { declared } = find({
      '.importlinter': '[importlinter]\nroot_package = a\n[importlinter:contract:x]\nname = X\ntype = layers\ncontainers =\n    a.one\n    a.two\nlayers =\n    web | api\n    domain\n',
    });
    expect(declared).toEqual({ file: '.importlinter', contracts: [{ name: 'X', type: 'layers', layers: ['web | api', 'domain'], containers: ['a.one', 'a.two'] }] });
  });

  it('reads TOML contracts and keeps only layers, forbidden and independence', () => {
    const { declared } = find({
      'pyproject.toml': '[tool.importlinter]\nroot_package = "a"\n[[tool.importlinter.contracts]]\nname = "p"\ntype = "protected"\n[[tool.importlinter.contracts]]\nname = "f"\ntype = "forbidden"\n[[tool.importlinter.contracts]]\ntype = "independence"\n',
    });
    expect(declared?.contracts.map((c) => [c.name, c.type])).toEqual([['f', 'forbidden'], ['contract-3', 'independence']]);
  });

  it('walks up from a workspace package to a rules file at the repository root', () => {
    const { declared } = find({ '.importlinter': '[importlinter]\nroot_package = a\n[importlinter:contract:x]\ntype = forbidden\n' }, 'svc/api');
    expect(declared?.file).toBe('.importlinter');
  });

  it('a package-level file is found before the root one', () => {
    const { declared } = find({
      '.importlinter': '[importlinter]\n[importlinter:contract:x]\ntype = forbidden\n',
      'svc/setup.cfg': '[importlinter]\n[importlinter:contract:y]\ntype = layers\n',
    }, 'svc');
    expect(declared?.file).toBe('svc/setup.cfg');
  });

  it('no file, or only files without direction contracts, is undefined', () => {
    expect(find({}).declared).toBeUndefined();
    expect(find({ 'setup.cfg': '[importlinter]\n[importlinter:contract:x]\ntype = protected\n' }).declared).toBeUndefined();
  });
});

describe('statement joins', () => {
  const info = {
    syntaxError: false,
    opensBuiltin: false,
    imports: [
      { line: 1, level: 0, modules: ['a'], lazy: false, typeOnly: false },
      { line: 2, level: 0, modules: ['b'], lazy: true, typeOnly: false },
      { line: 3, level: 0, modules: ['c'], lazy: false, typeOnly: true },
      { line: 3, level: 0, modules: ['d'], lazy: false, typeOnly: false },
      { line: 4, level: 0, modules: ['pkg.sub'], lazy: false, typeOnly: true },
    ],
  };

  it('an edge is runtime when any occurrence line has a plain statement or no statement', () => {
    expect(isRuntime(info, [1])).toBe(true);
    expect(isRuntime(info, [2])).toBe(false);
    expect(isRuntime(info, [3])).toBe(true);
    expect(isRuntime(info, [2, 3])).toBe(true);
    expect(isRuntime(info, [99])).toBe(true);
    expect(isRuntime(info, [])).toBe(true);
    expect(isRuntime(undefined, [5])).toBe(true);
  });

  it('type-only means every occurrence is a type-only statement', () => {
    expect(allTypeOnly(info, [4])).toBe(true);
    expect(allTypeOnly(info, [3])).toBe(false);
    expect(allTypeOnly(info, [4, 1])).toBe(false);
    expect(allTypeOnly(info, [])).toBe(false);
    expect(externalTypeOnly(info, 'pkg')).toBe(true);
    expect(externalTypeOnly(info, 'a')).toBe(false);
    expect(externalTypeOnly(info, 'zzz')).toBe(false);
  });
});
