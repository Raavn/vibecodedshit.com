import { describe, expect, it } from 'vitest';
import { parseTsFile } from '../../scope/ts-lines.js';
import { countExportedSymbols } from './exports.js';

const count = (text: string): number => countExportedSymbols(parseTsFile('x.ts', text));

describe('countExportedSymbols', () => {
  it('counts declarations by name', () => {
    expect(
      count(`export function a() {}
export class B {}
export interface C {}
export type D = number;
export enum E { X }
export namespace F {}
const hidden = 1;`),
    ).toBe(6);
  });

  it('counts function overloads and merged declarations once', () => {
    expect(
      count(`export function f(a: string): void;
export function f(a: number): void;
export function f(a: unknown): void {}
export interface G {}
export interface G { x: number }`),
    ).toBe(2);
  });

  it('counts each binding of a destructured const', () => {
    expect(count(`export const { a, b: [c, d], ...rest } = source;\nexport const e = 1, f = 2;`)).toBe(6);
  });

  it('counts every specifier of a re-export list', () => {
    expect(count(`const a = 1, b = 2;\nexport { a, b as c };\nexport { x, y } from './m';\nexport type { T } from './t';`)).toBe(5);
  });

  it('counts default, export =, and export * as ns once, and export * zero', () => {
    expect(count(`export default function () {}`)).toBe(1);
    expect(count(`const a = 1;\nexport default a;`)).toBe(1);
    expect(count(`const a = 1;\nexport = a;`)).toBe(1);
    expect(count(`export * as ns from './m';`)).toBe(1);
    expect(count(`export * from './m';`)).toBe(0);
  });
});
