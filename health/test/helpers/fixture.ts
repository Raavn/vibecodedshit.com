import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/**
 * Copy a fixture into a temp directory and make it a git repository.
 * `trackedFiles` are written before `git add` and so are tracked.
 * `extraFiles` are written after it, so git does not know them
 * (for example `node_modules/x.js`).
 */
export function materializeFixture(
  name: string,
  extraFiles: Record<string, string> = {},
  trackedFiles: Record<string, string> = {},
): string {
  const dir = mkdtempSync(path.join(tmpdir(), `health-${name}-`));
  cpSync(path.join(fixturesDir, name), dir, { recursive: true });
  write(dir, trackedFiles);
  for (const args of [['init', '-q'], ['add', '-A', '-f']]) {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  write(dir, extraFiles);
  return dir;
}
