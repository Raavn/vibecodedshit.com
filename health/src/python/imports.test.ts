import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createToolKit } from '../tools/kit.js';
import type { MeasureContext } from '../measure/types.js';
import { readPythonImports, type PythonImportsInfo } from './imports.js';

async function read(files: Record<string, string>): Promise<Record<string, PythonImportsInfo>> {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'health-imports-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(repoPath, name), text);
  const scope = { files: Object.keys(files).map((p) => ({ path: p, group: 'python' })) } as unknown as MeasureContext['scope'];
  return readPythonImports({ tools: createToolKit(), repoPath, scope });
}

describe('imports_helper.py', () => {
  it('reports every import form with its line, level and modules', async () => {
    const out = await read({
      'a.py': 'import a.b, c\nfrom x.y import z\nfrom . import w\nfrom .m import n\nfrom ..pkg import q\nfrom x import (\n    a,\n    b,\n)\nimport p; import r\n',
    });
    expect(out['a.py']?.imports).toEqual([
      { line: 1, level: 0, modules: ['a.b', 'c'], lazy: false, typeOnly: false },
      { line: 2, level: 0, modules: ['x.y'], lazy: false, typeOnly: false },
      { line: 3, level: 1, modules: [''], lazy: false, typeOnly: false },
      { line: 4, level: 1, modules: ['m'], lazy: false, typeOnly: false },
      { line: 5, level: 2, modules: ['pkg'], lazy: false, typeOnly: false },
      { line: 6, level: 0, modules: ['x'], lazy: false, typeOnly: false },
      { line: 10, level: 0, modules: ['p'], lazy: false, typeOnly: false },
      { line: 10, level: 0, modules: ['r'], lazy: false, typeOnly: false },
    ]);
  });

  it('flags function, async function and lambda bodies as lazy, but not class bodies or a class inside a function', async () => {
    const out = await read({
      'l.py': [
        'def f():',
        '    import a',
        'async def g():',
        '    import b',
        'class C:',
        '    import c',
        '    def m(self):',
        '        import d',
        'h = lambda: __import__("x")',
        'def outer():',
        '    class Inner:',
        '        import e',
        '',
      ].join('\n'),
    });
    const lazy = Object.fromEntries((out['l.py']?.imports ?? []).map((i) => [i.modules[0], i.lazy]));
    expect(lazy).toEqual({ a: true, b: true, c: false, d: true, e: true });
  });

  it('flags the body of if TYPE_CHECKING at any nesting, not the else branch', async () => {
    const out = await read({
      't.py': [
        'import typing',
        'from typing import TYPE_CHECKING',
        'if TYPE_CHECKING:',
        '    import a',
        '    if True:',
        '        import b',
        'else:',
        '    import c',
        'if typing.TYPE_CHECKING:',
        '    import d',
        'if not TYPE_CHECKING:',
        '    import e',
        '',
      ].join('\n'),
    });
    const flags = Object.fromEntries((out['t.py']?.imports ?? []).map((i) => [i.modules[0], i.typeOnly]));
    expect(flags).toEqual({ typing: false, a: true, b: true, c: false, d: true, e: false });
  });

  it('opensBuiltin: open() and builtins.open() count; Path.open, io.open and a locally bound open do not', async () => {
    const out = await read({
      'o1.py': 'def f():\n    return open("x")\n',
      'o2.py': 'import builtins\n\n\ndef f():\n    return builtins.open("x")\n',
      'o3.py': 'from pathlib import Path\n\n\ndef f():\n    return Path("x").open()\n',
      'o4.py': 'import io\n\n\ndef f():\n    return io.open("x")\n',
      'o5.py': 'def open(p):\n    return p\n\n\ndef f():\n    return open("x")\n',
      'o6.py': 'from gzip import open\n\n\ndef f():\n    return open("x")\n',
      'o7.py': 'def f(open):\n    return open("x")\n',
      'o8.py': 'def f():\n    return None\n',
    });
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.opensBuiltin]))).toEqual({
      'o1.py': true, 'o2.py': true, 'o3.py': false, 'o4.py': false, 'o5.py': false, 'o6.py': false, 'o7.py': false, 'o8.py': false,
    });
  });

  it('a syntax error gives no imports and syntaxError true', async () => {
    const out = await read({ 'bad.py': 'import a\ndef (:\n' });
    expect(out['bad.py']).toEqual({ syntaxError: true, imports: [], opensBuiltin: false });
  });
});
