import { describe, expect, it } from 'vitest';
import { parseTsFile } from '../../../scope/ts-lines.js';
import { callsGlobalFetch, classifyImports, hasUseClient, packageName } from './classify.js';

const occ = (code: string) => classifyImports(parseTsFile('x.ts', code));

describe('classifyImports', () => {
  it('marks every type-only form', () => {
    const found = occ(`
import type { A } from 'a';
import { type B, type C } from 'b';
import { type D, e } from 'c';
import type F = require('f');
export type { G } from 'g';
export { type H } from 'h';
export * from 'i';
type J = import('j').T;
import {} from 'k';
import 'l';
`);
    expect(found.map((o) => [o.specifier, o.typeOnly])).toEqual([
      ['a', true], ['b', true], ['c', false], ['f', true], ['g', true], ['h', true], ['i', false], ['j', true], ['k', false], ['l', false],
    ]);
  });

  it('records kind and whether the import is top level', () => {
    const found = occ(`
import a from './a';
const b = require('./b');
function f() { return import('./c'); }
const g = () => require('./d');
class K { m() { return require('./e'); } }
const h = import('./h');
`);
    expect(found.map((o) => [o.specifier, o.kind, o.topLevel])).toEqual([
      ['./a', 'static', true], ['./b', 'require', true], ['./c', 'dynamic', false], ['./d', 'require', false], ['./e', 'require', false], ['./h', 'dynamic', true],
    ]);
  });
});

describe('packageName', () => {
  it('drops node: and keeps one segment, two for scoped packages', () => {
    expect(['node:fs', 'fs/promises', 'react/jsx-runtime', '@prisma/client', '@scope/pkg/sub'].map(packageName)).toEqual(['fs', 'fs', 'react', '@prisma/client', '@scope/pkg']);
  });
});

describe('callsGlobalFetch', () => {
  const call = (code: string) => callsGlobalFetch(parseTsFile('x.ts', code));
  it('counts an unbound call and globalThis.fetch', () => {
    expect(call('export const x = () => fetch("/a");')).toBe(true);
    expect(call('export const x = () => globalThis.fetch("/a");')).toBe(true);
  });
  it('does not count a local declaration, an import, a parameter or a member call', () => {
    expect(call('function fetch() {}\nfetch();')).toBe(false);
    expect(call('import { fetch } from "x";\nfetch();')).toBe(false);
    expect(call('export function f(fetch: () => void) { fetch(); }')).toBe(false);
    expect(call('export const x = (c: { fetch(): void }) => c.fetch();')).toBe(false);
    expect(call('window.fetch("/a");')).toBe(false);
  });
});

describe('hasUseClient', () => {
  it('needs the directive as the first statement', () => {
    expect(hasUseClient(parseTsFile('x.tsx', '"use client";\nexport const a = 1;'))).toBe(true);
    expect(hasUseClient(parseTsFile('x.tsx', 'import a from "a";\n"use client";'))).toBe(false);
  });
});
