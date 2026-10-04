type Handler = (e: number) => number;
export function annotated(a: number, b: string): void {}
export function untyped(a, b) {}
export function defaults(a = 1, b?: number, c?) {}
export function overloaded(a: string): void;
export function overloaded(a: number, b: number): void;
export function overloaded(a: any, b?: any): void {}
export const arrow = (x: number) => x;
export const fnExpr = function (x) { return x; };
export const handler: Handler = (e) => e;
export const sat = ((e) => e) satisfies Handler;
export const asd = ((e) => e) as Handler;
export const obj = { method(a) {} };
const hidden = (a) => a;
function local(a) {}
function notExported(a) {}
export { local, hidden as renamed };
export default function (a: number, ...rest: string[]): void {}
export function destruct({ a, b }, [c]: number[]) {}
export function rest(...args) {}
export function withThis(this: Window, a: number) {}
export class Box {
  constructor(a: number, public b, private c: string) {}
  run(x) {}
  static make(x: number) {}
  private secret(x) {}
  protected guarded(x) {}
  #hash(x) {}
  get size() { return 1; }
  set size(v) {}
}
export function outer(a: number): void {
  function inner(x) {}
  [1].map((y) => y);
}
