import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepos } from './repos.js';

function tree(paths: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'repos-'));
  for (const p of paths) {
    const full = path.join(root, p);
    if (p.endsWith('/.git')) mkdirSync(full, { recursive: true });
    else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, 'gitdir: elsewhere\n');
    }
  }
  return root;
}

describe('findRepos', () => {
  it('finds clones at depth 1 and inside grouping folders, skipping worktrees, archives and node_modules', () => {
    const root = tree([
      'app/.git',
      '_Group/one/.git',
      '_Group/two/.git',
      'wt/.git',
      '___archive/old/.git',
      'Archive-2024/.git',
      'node_modules/pkg/.git',
      '.hidden/.git',
      'empty/readme/x',
    ]);
    const rel = findRepos(root).map((p) => path.relative(root, p));
    expect(rel).toEqual(['_Group/one', '_Group/two', 'app', 'wt']);
  });

  it('does not descend into a linked worktree', () => {
    const root = tree(['wt-linked/.git', 'wt-linked/nested/.git']);
    expect(findRepos(root).map((p) => path.relative(root, p))).toEqual(['wt-linked']);
  });

  it('skips a top-level linked worktree and what is inside it', () => {
    const root = tree(['linked/.git-placeholder']);
    writeFileSync(path.join(root, 'linked', '.git'), 'gitdir: /elsewhere\n');
    mkdirSync(path.join(root, 'linked', 'inner', '.git'), { recursive: true });
    expect(findRepos(root)).toEqual([]);
  });
});
