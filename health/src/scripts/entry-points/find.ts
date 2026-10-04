import path from 'node:path';
import { readTracked } from '../../scope/tracked.js';

/** The first of `names` that is tracked in `dir`, or in the nearest ancestor when `ancestors` is set. */
export function findFile(repoPath: string, dir: string, names: string[], ancestors: boolean): { file: string; text: string } | undefined {
  for (let current = path.posix.normalize(dir === '' ? '.' : dir); ; current = path.posix.dirname(current)) {
    for (const name of names) {
      const file = path.posix.join(current, name);
      const text = readTracked(repoPath, file);
      if (text !== null) return { file, text };
    }
    if (!ancestors || current === '.' || current === '' || current.startsWith('..')) return undefined;
  }
}

/** Join backslash-continued lines. */
export function joinContinuations(lines: string[]): string[] {
  const out: string[] = [];
  let pending = '';
  for (const line of lines) {
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1).trimEnd()} `;
      continue;
    }
    out.push((pending + line).trim());
    pending = '';
  }
  if (pending.trim() !== '') out.push(pending.trim());
  return out;
}
