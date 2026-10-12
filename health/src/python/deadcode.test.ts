import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzePythonDeadCode } from './deadcode.js';

function bases(files: Record<string, string>): Record<string, Record<string, { name: string; file: string | null; class: string | null }[]>> {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'health-deadcode-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repoPath, name)), { recursive: true });
    writeFileSync(path.join(repoPath, name), text);
  }
  const infos = analyzePythonDeadCode(repoPath, Object.keys(files));
  return Object.fromEntries(
    Object.entries(infos).map(([file, info]) => [file, info.ok ? Object.fromEntries(Object.entries(info.classes).map(([c, v]) => [c, v.bases])) : {}]),
  );
}

describe('dead_code_helper.py class bases', () => {
  it('resolves bases defined in the scanned files and marks the rest as outside', () => {
    const out = bases({
      'app/base.py': 'class Base:\n    def run(self):\n        return 1\n',
      'app/sub/mid.py': 'from app.base import Base\n\n\nclass Mid(Base):\n    pass\n',
      'app/server.py': [
        'import http.server',
        'from http.server import BaseHTTPRequestHandler',
        'from typing import Generic, TypeVar',
        'from .base import Base',
        'from . import base as basemod',
        'from app.sub.mid import Mid',
        'T = TypeVar("T")',
        'class Handler(BaseHTTPRequestHandler): pass',
        'class Dotted(http.server.BaseHTTPRequestHandler): pass',
        'class Child(Base): pass',
        'class ViaModule(basemod.Base): pass',
        'class ReExported(Mid): pass',
        'class Plain(object): pass',
        'class Box(Generic[T]): pass',
        'class Same(Child): pass',
        '',
      ].join('\n'),
    });
    const server = out['app/server.py'] ?? {};
    expect(server.Handler).toEqual([{ name: 'BaseHTTPRequestHandler', file: null, class: null }]);
    expect(server.Dotted).toEqual([{ name: 'http.server.BaseHTTPRequestHandler', file: null, class: null }]);
    expect(server.Child).toEqual([{ name: 'Base', file: 'app/base.py', class: 'Base' }]);
    expect(server.ViaModule).toEqual([{ name: 'basemod.Base', file: 'app/base.py', class: 'Base' }]);
    expect(server.ReExported).toEqual([{ name: 'Mid', file: 'app/sub/mid.py', class: 'Mid' }]);
    expect(server.Plain).toEqual([]);
    expect(server.Box).toEqual([]);
    expect(server.Same).toEqual([{ name: 'Child', file: 'app/server.py', class: 'Child' }]);
    expect(out['app/sub/mid.py']?.Mid).toEqual([{ name: 'Base', file: 'app/base.py', class: 'Base' }]);
  });
});
