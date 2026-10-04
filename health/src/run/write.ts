import { writeFileSync } from 'node:fs';
import type { RunFile } from './schema.js';

export function writeRun(file: string, run: RunFile): void {
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
}
