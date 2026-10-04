import { describe, expect, it } from 'vitest';
import { analyzeTsFile } from './ts-lines.js';

describe('analyzeTsFile', () => {
  it('does not count blank lines, comments, JSDoc or a shebang', () => {
    const text = ['#!/usr/bin/env node', '// c', '/** doc', ' * more', ' */', '', 'export function f() {', '  return 1; // trailing', '}', ''].join('\n');
    const info = analyzeTsFile('a.ts', text);
    expect(info.codeLines).toBe(3);
    expect(info.definesCallable).toBe(true);
  });

  it('counts multi-line template literal lines as code', () => {
    const text = 'export const s = `\nline\n${1}`;\n';
    expect(analyzeTsFile('a.ts', text).codeLines).toBe(3);
  });

  it('counts JSX text lines as code', () => {
    const text = 'export const A = () => (\n  <div>\n    hello\n  </div>\n);\n';
    expect(analyzeTsFile('a.tsx', text).codeLines).toBe(5);
  });

  it('treats re-exports, type declarations and constants as not callable', () => {
    expect(analyzeTsFile('a.ts', "export * from './b.js';\n").definesCallable).toBe(false);
    expect(analyzeTsFile('a.ts', 'export interface A { f(): void }\nexport type B = () => void;\n').definesCallable).toBe(false);
    expect(analyzeTsFile('a.ts', 'export const X = 1;\n').definesCallable).toBe(false);
  });

  it('treats arrow functions, methods and classes as callable', () => {
    expect(analyzeTsFile('a.ts', 'export const f = () => 1;\n').definesCallable).toBe(true);
    expect(analyzeTsFile('a.ts', 'export class A {}\n').definesCallable).toBe(true);
    expect(analyzeTsFile('a.js', 'const o = { m() {} };\n').definesCallable).toBe(true);
  });
});
