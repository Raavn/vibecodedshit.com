import { closeSync, openSync, readSync } from 'node:fs';
import type { ResolvedTool } from '../../../tools/kit.js';

export type InterpreterResult = { interpreter: string } | { unavailable: string };

/**
 * The Python interpreter that holds import-linter and grimp: the `#!<absolute path>` first line of the
 * resolved `lint-imports` script (a pipx or uv tool environment keeps them out of the system python3).
 * Any other first line, or an unreadable file, is unavailable; nothing falls back to the system python3.
 * A tool resolved in the image names its interpreter itself.
 */
export function pyInterpreter(tool: Pick<ResolvedTool, 'command' | 'interpreter'>): InterpreterResult {
  if (tool.interpreter !== undefined) return { interpreter: tool.interpreter };
  const fail = (): InterpreterResult => ({ unavailable: `import-linter: cannot read its Python interpreter from ${tool.command}` });
  let line: string;
  try {
    const fd = openSync(tool.command, 'r');
    try {
      const buffer = Buffer.alloc(512);
      const read = readSync(fd, buffer, 0, buffer.length, 0);
      line = buffer.toString('utf8', 0, read).split(/\r?\n/, 1)[0] ?? '';
    } finally {
      closeSync(fd);
    }
  } catch {
    return fail();
  }
  const match = /^#!(\/\S+)$/.exec(line.trim());
  if (!match?.[1] || /(^|\/)env$/.test(match[1])) return fail();
  return { interpreter: match[1] };
}
