export function hatches(input: unknown, list: string[]): number {
  const asString = input as string;
  const unknownCast = input as unknown as number;
  const anyCast = input as any;
  const anyType: any = input;
  const angle = <string>input;
  const first = list[0]!;
  const constant = ['a'] as const;
  // @ts-ignore
  const ignored: number = 'x';
  // @ts-expect-error
  const expectedError: number = 'y';
  const text = '// @ts-ignore in a string';
  const template = `@ts-ignore ${asString}`;
  return asString.length + first.length + constant.length;
}
export class Holder {
  value!: string;
}
