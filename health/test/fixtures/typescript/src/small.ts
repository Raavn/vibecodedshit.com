/**
 * Doc comment, not counted.
 */
export function add(a: number, b: number): number {
  // inline comment, not counted
  return a + b;
}

export class Counter {
  private n = 0;
  inc(): number {
    this.n += 1;
    return this.n;
  }
}

export const tpl = (name: string): string => `
hello
${name}`;
