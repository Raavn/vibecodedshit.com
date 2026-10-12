import { describe, expect, it } from 'vitest';
import type { PythonBase, PythonDeadCodeInfo, PythonSymbol } from '../python/deadcode.js';
import { isOverride } from './p4-4.js';

const method = (qualname: string): PythonSymbol => ({
  name: qualname.split('.')[1] ?? qualname,
  qualname,
  kind: 'method',
  line: 1,
  startLine: 1,
  decorated: false,
});

function info(classes: Record<string, PythonBase[]>, methods: string[] = []): PythonDeadCodeInfo {
  return {
    ok: true,
    symbols: methods.map(method),
    allNames: null,
    imports: [],
    classes: Object.fromEntries(Object.entries(classes).map(([name, bases]) => [name, { bases }])),
  };
}

const external = (name: string): PythonBase => ({ name, file: null, class: null });
const local = (file: string, cls: string): PythonBase => ({ name: cls, file, class: cls });

describe('4.4 Python overrides', () => {
  it('treats a method of a class with a base outside the repository as used', () => {
    const infos = { 'a.py': info({ Handler: [external('BaseHTTPRequestHandler')] }, ['Handler.do_GET']) };
    expect(isOverride(infos, 'a.py', 'Handler.do_GET')).toBe(true);
  });

  it('treats an override of a repository base method as used, through several levels', () => {
    const infos = {
      'base.py': info({ Base: [] }, ['Base.run']),
      'mid.py': info({ Mid: [local('base.py', 'Base')] }),
      'child.py': info({ Child: [local('mid.py', 'Mid')] }, ['Child.run', 'Child.other']),
    };
    expect(isOverride(infos, 'child.py', 'Child.run')).toBe(true);
    expect(isOverride(infos, 'child.py', 'Child.other')).toBe(false);
  });

  it('applies the external-base rule through repository base classes', () => {
    const infos = {
      'h.py': info({ MyHandler: [external('BaseHTTPRequestHandler')] }),
      'c.py': info({ Child: [local('h.py', 'MyHandler')] }, ['Child.do_GET']),
    };
    expect(isOverride(infos, 'c.py', 'Child.do_GET')).toBe(true);
  });

  it('keeps a method of a class without bases unused, and stops on cycles', () => {
    const infos = {
      'p.py': info({ Plain: [], A: [local('p.py', 'B')], B: [local('p.py', 'A')] }, ['Plain.helper', 'A.x']),
    };
    expect(isOverride(infos, 'p.py', 'Plain.helper')).toBe(false);
    expect(isOverride(infos, 'p.py', 'A.x')).toBe(false);
    expect(isOverride(infos, 'p.py', 'unused_fn')).toBe(false);
  });
});
