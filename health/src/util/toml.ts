import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';

/** A missing file or invalid TOML gives undefined; the caller adds the warning for invalid TOML. */
export function readToml(absPath: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}
