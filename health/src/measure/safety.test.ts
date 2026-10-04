import { describe, expect, it } from 'vitest';
import { measureFiles, unitsOf, warningsOf } from '../../test/helpers/measure.js';

const fn = (name: string): string => `export function ${name}() { return 1; }\n`;
const ratio = (numerator: number, denominator: number) => ({ kind: 'ratio', numerator, denominator, scale: 100 });
const only = (m: Awaited<ReturnType<typeof measureFiles>>) => {
  const units = unitsOf(m);
  expect(units).toHaveLength(1);
  return units[0]?.raw;
};

describe('1.4 modules with tests (TS/JS)', () => {
  const files: Record<string, string> = {
    'src/a.ts': fn('a'),
    'src/b.ts': fn('b'),
    'src/index.ts': "export { b } from './b';\n",
    'src/c.ts': fn('c'),
    'src/d.ts': fn('d'),
    'src/e.ts': fn('e'),
    'src/f.ts': `export interface T { x: number }\n${fn('fOnly')}`,
    'src/g.ts': `import { h } from './h';\nexport { h };\n${fn('g')}`,
    'src/h.ts': fn('h'),
    'src/i.ts': fn('i'),
    'src/j.ts': fn('j'),
    'src/ns.ts': "export * from './n1';\n",
    'src/n1.ts': fn('n1fn'),
    'src/a2.ts': `import { c } from './c';\n${fn('a2')}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] }, moduleResolution: 'bundler', module: 'esnext' } }),
    'tests/a.test.ts': "import { a } from '../src/a';\nimport lodash from 'lodash';\nimport { a2 } from '../src/a2';\n",
    'tests/b.test.ts': "import { b } from '../src';\n",
    'tests/d.test.ts': "const d = require('../src/d');\n",
    'tests/e.test.ts': "async function t() { return import('../src/e'); }\n",
    'tests/f.test.ts': "import type { T } from '../src/f';\n",
    'tests/g.test.ts': "import { h } from '../src/g';\n",
    'tests/i.test.ts': "vi.mock('../src/i');\nconst name = './x';\nrequire(name);\nrequire.resolve('../src/i');\n",
    'tests/j.test.ts': "import { j } from '@/j';\n",
    'tests/ns.test.ts': "import * as m from '../src/ns';\nm.n1fn();\n",
  };

  it('counts logic files imported directly: static, type, require, dynamic, barrel, mixed file, alias and namespace', async () => {
    // Logic files: a b c d e f g h i j n1 a2 = 12. Credited: a a2 b d e f h j n1 = 9 (c is only imported by a2, g only re-exports h, i is mocked).
    expect(only(await measureFiles('1.4', files))).toEqual(ratio(9, 12));
  });

  it('a barrel is not in the denominator and gets no credit', async () => {
    const result = unitsOf(await measureFiles('1.4', files));
    expect(result[0]?.weight).toBeGreaterThan(0);
    expect((result[0]?.raw as { denominator: number }).denominator).toBe(12);
  });

  it('a test at the root credits files of a package, and another package counts separately', async () => {
    const m = await measureFiles('1.4', {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/a/package.json': '{"name":"a"}',
      'packages/b/package.json': '{"name":"b"}',
      'packages/a/src/x.ts': fn('x'),
      'packages/b/src/y.ts': fn('y'),
      'packages/b/src/z.ts': fn('z'),
      'tests/x.test.ts': "import { x } from '../packages/a/src/x';\nimport { y } from '../packages/b/src/y';\n",
    });
    expect(Object.fromEntries(unitsOf(m).map((u) => [u.package, u.raw]))).toEqual({ 'packages/a': ratio(1, 1), 'packages/b': ratio(1, 2) });
  });

  it('a unit with no test at all is 0 of its logic files', async () => {
    expect(only(await measureFiles('1.4', { 'src/a.ts': fn('a') }))).toEqual(ratio(0, 1));
  });
});

describe('1.4 modules with tests (Python)', () => {
  const files: Record<string, string> = {
    'app/__init__.py': 'from .core import run\nfrom . import util\n',
    'app/core.py': 'def run():\n    return 1\n',
    'app/util.py': 'def helper():\n    return 1\n',
    'app/other.py': 'def other():\n    return 1\n',
    'app/lonely.py': 'def lonely():\n    return 1\n',
    'app/deep/__init__.py': '',
    'app/deep/mod.py': 'def deep():\n    return 1\n',
    'app/rel.py': 'def rel():\n    return 1\n',
    'tests/helpers.py': 'def h():\n    return 1\n',
    'tests/test_core.py': 'import requests\nfrom app import run\n',
    'tests/test_util.py': 'from app.util import helper\n',
    'tests/test_other.py': 'from app import other\n',
    'tests/test_deep.py': 'import app.deep.mod\n',
    'tests/test_rel.py': 'from .helpers import h\n\ndef test_x():\n    from app.rel import rel\n',
  };

  it('follows __init__.py re-exports to the defining file, credits a submodule imported by name, and counts imports inside functions', async () => {
    // Logic: core util other lonely mod rel = 6 (tests/helpers.py is a test file, app/__init__.py only re-exports).
    // Credited: core (via re-export), util, other (submodule), mod, rel (function-level import) = 5.
    expect(only(await measureFiles('1.4', files))).toEqual(ratio(5, 6));
  });

  it('import a.b.c credits only a/b/c.py, not the implicit parents', async () => {
    const m = await measureFiles('1.4', {
      'pkg/__init__.py': 'def top():\n    return 1\n',
      'pkg/sub/__init__.py': 'def sub():\n    return 1\n',
      'pkg/sub/leaf.py': 'def leaf():\n    return 1\n',
      'tests/test_leaf.py': 'import pkg.sub.leaf\n',
    });
    expect(only(m)).toEqual(ratio(1, 3));
  });

  it('a star import credits the module and the targets of its __init__.py bindings', async () => {
    const m = await measureFiles('1.4', {
      'app/__init__.py': 'from .core import run\n',
      'app/core.py': 'def run():\n    return 1\n',
      'app/spare.py': 'def spare():\n    return 1\n',
      'tests/test_star.py': 'from app import *\n',
    });
    expect(only(m)).toEqual(ratio(1, 2));
  });

  it('a test file with a syntax error credits nothing and is reported', async () => {
    const m = await measureFiles('1.4', { 'app.py': 'def f():\n    return 1\n', 'tests/test_bad.py': 'from app import f\ndef (\n' });
    expect(only(m)).toEqual(ratio(0, 1));
    expect(warningsOf(m).join()).toContain('tests/test_bad.py');
  });
});

describe('1.5 tests that assert something', () => {
  const ts = [
    "import { chk } from './h';",
    'function check(x: number) { expect(x).toBe(1); }',
    'function outer() { check(1); }',
    "describe('suite', () => {",
    "  it('a', () => { expect(1).toBe(1); });",
    "  test('b', () => {});",
    "  it.each([1, 2])('c %d', (n) => { expect(n).toBe(n); });",
    "  it.only('d', () => { assert.equal(1, 1); });",
    "  it.skip('e', () => { expect(1).toBe(1); });",
    "  it.todo('f');",
    "  it('g', () => { check(1); });",
    "  it('h', () => { outer(); });",
    "  test.concurrent('i', async () => { await expect(Promise.resolve(1)).resolves.toBe(1); });",
    "  test('j', (t) => { t.assert.equal(1, 1); });",
    "  test('k', (t) => { t.true(true); });",
    "  it('l', () => { expectTypeOf<string>().toBeString(); });",
    "  it('m');",
    "  it.each`a | b\n    ${1} | ${2}`('n', ({ a }) => { expect(a).toBe(1); });",
    "  it.fails('p', () => { expect(1).toBe(2); });",
    "  it('o', () => { chk(); });",
    '});',
    '',
  ].join('\n');

  it('counts it/test and their .each/.only/.concurrent forms; one level of helper; no .skip, .todo, .fails or describe', async () => {
    // Cases: a b c d g h i j k l m n o = 13. Assertions: a c d g i j l n = 8.
    const m = await measureFiles('1.5', { 'src/x.ts': fn('x'), 'src/x.test.ts': ts });
    expect(only(m)).toEqual(ratio(8, 13));
  });

  it('Python: test_* at module level and in any class; assert, self.assert*, pytest.raises/warns, assert_*; helpers one level; nested defs are not cases', async () => {
    const py = [
      'import pytest',
      'from unittest import TestCase, mock',
      '',
      'def test_a():\n    assert 1',
      'def test_b():\n    pass',
      'def test_c():\n    with pytest.raises(ValueError):\n        int("x")',
      'def test_d():\n    m = mock.Mock()\n    m.assert_called_once()',
      'def helper():\n    assert True',
      'def test_e():\n    helper()',
      'def helper2():\n    helper()',
      'def test_f():\n    helper2()',
      'class TestK(TestCase):\n    def test_g(self):\n        self.assertEqual(1, 1)\n    def test_h(self):\n        pass\n    def check(self):\n        self.assertTrue(True)\n    def test_i(self):\n        self.check()',
      'def test_j():\n    def inner():\n        assert 1\n    inner()',
      'def test_k():\n    if True:\n        for i in []:\n            assert i',
      'def test_l():\n    def test_nested():\n        assert 1',
      'class Plain:\n    def test_m(self):\n        assert 1',
      '',
    ].join('\n');
    // Cases: a b c d e f g h i j k l m = 13. Assertions: a c d e g i j k m = 9.
    const m = await measureFiles('1.5', { 'app.py': 'def f():\n    return 1\n', 'tests/test_x.py': py, 'tests/test_bad.py': 'def (\n' });
    expect(only(m)).toEqual(ratio(9, 13));
    expect(warningsOf(m).join()).toContain('tests/test_bad.py');
  });

  it('pytest.raises through from-import and an import alias counts', async () => {
    const m = await measureFiles('1.5', {
      'app.py': 'def f():\n    return 1\n',
      'tests/test_a.py': 'from pytest import raises\n\ndef test_a():\n    with raises(ValueError):\n        pass\n',
      'tests/test_b.py': 'import pytest as pt\n\ndef test_b():\n    with pt.warns(UserWarning):\n        pass\n',
    });
    expect(only(m)).toEqual(ratio(2, 2));
  });

  it('a package with tests and no logic file is dropped; units come from logic files', async () => {
    const m = await measureFiles('1.5', {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/a/package.json': '{"name":"a"}',
      'packages/b/package.json': '{"name":"b"}',
      'packages/a/src/x.ts': fn('x'),
      'packages/a/src/x.test.ts': "it('a', () => { expect(1).toBe(1); });\n",
      'packages/b/src/y.test.ts': "it('b', () => {});\n",
    });
    expect(Object.fromEntries(unitsOf(m).map((u) => [u.package, u.raw]))).toEqual({ 'packages/a': ratio(1, 1) });
  });

  it('no test cases gives 0 of 0 (scored as when_empty)', async () => {
    expect(only(await measureFiles('1.5', { 'src/a.ts': fn('a') }))).toEqual(ratio(0, 0));
  });
});
