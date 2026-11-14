import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** A clone has a `.git` directory; a linked worktree has a `.git` file and is skipped (its main checkout is scanned). */
const isClone = (dir: string): boolean => isDir(path.join(dir, '.git'));

const skipped = (name: string): boolean => name.startsWith('.') || name === 'node_modules' || /archive/i.test(name);

/**
 * Git clones under `root`: each folder at depth 1 that is a clone, and inside a folder that is not one, each clone at
 * depth 2 (grouping folders like `_Aimeko/`). Hidden folders, `node_modules` and any folder with "archive" in its name
 * are skipped. Sorted by path.
 */
export function findRepos(root: string): string[] {
  const repos: string[] = [];
  const children = (dir: string): string[] =>
    readdirSync(dir)
      .filter((name) => !skipped(name))
      .map((name) => path.join(dir, name))
      .filter(isDir);
  for (const dir of children(root)) {
    if (isClone(dir)) repos.push(dir);
    else if (!existsGitFile(dir)) repos.push(...children(dir).filter(isClone));
  }
  return repos.sort();
}

function existsGitFile(dir: string): boolean {
  try {
    return statSync(path.join(dir, '.git')).isFile();
  } catch {
    return false;
  }
}
