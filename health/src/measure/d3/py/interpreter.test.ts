import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pyInterpreter } from './interpreter.js';

function script(firstLine: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'health-shebang-')), 'lint-imports');
  writeFileSync(file, `${firstLine}\nprint("x")\n`);
  chmodSync(file, 0o755);
  return file;
}

describe('pyInterpreter', () => {
  it('reads an absolute shebang', () => {
    expect(pyInterpreter({ command: script('#!/opt/venv/bin/python3') })).toEqual({ interpreter: '/opt/venv/bin/python3' });
  });

  it.each(['#!/usr/bin/env python3', '#!/usr/bin/python3 -E', '#!python', 'import sys', ''])('rejects %j', (line) => {
    const command = script(line);
    expect(pyInterpreter({ command })).toEqual({ unavailable: `import-linter: cannot read its Python interpreter from ${command}` });
  });

  it('rejects a missing file', () => {
    expect(pyInterpreter({ command: '/nonexistent/lint-imports' })).toEqual({ unavailable: 'import-linter: cannot read its Python interpreter from /nonexistent/lint-imports' });
  });
});
