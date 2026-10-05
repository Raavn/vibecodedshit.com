import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginRoot = path.resolve(import.meta.dirname, '../..');

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => statSync(path.join(dir, f)).isFile())
    .sort();
}

describe('committed dist', () => {
  it('equals a fresh build of src', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'health-dist-'));
    const tsc = path.join(pluginRoot, 'node_modules/typescript/bin/tsc');
    const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', out], { cwd: pluginRoot, encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const fresh = listFiles(out);
    expect(listFiles(path.join(pluginRoot, 'dist'))).toEqual(fresh);
    for (const file of fresh) {
      expect(readFileSync(path.join(pluginRoot, 'dist', file), 'utf8'), file).toBe(readFileSync(path.join(out, file), 'utf8'));
    }
  }, 60_000);
});
