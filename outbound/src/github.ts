import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type Signal = 'LOVABLE' | 'V0' | 'BOLT' | 'REPLIT';
export const DEFAULT_SIGNALS: Signal[] = ['LOVABLE', 'V0', 'BOLT'];

export interface Candidate {
  fullName: string;
  url: string;
  homepage: string | null;
  owner: string;
  pushedAt: string;
  signal: Signal;
}

/** Runs `gh api` with the given arguments and returns stdout. Injected so tests never touch the network. */
export type Gh = (args: string[]) => Promise<string>;

export const ghApi: Gh = async (args) => {
  const { stdout } = await execFileAsync('gh', ['api', ...args], { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
};

const query = (q: string, extra: string[] = []): string[] => ['-X', 'GET', '-f', `q=${q}`, ...extra];

interface RepoItem {
  full_name: string;
  html_url: string;
  homepage: string | null;
  pushed_at: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  owner: { login: string };
}

function toCandidate(item: RepoItem, signal: Signal): Candidate | null {
  if (item.fork || item.archived || item.private) return null;
  return {
    fullName: item.full_name,
    url: item.html_url,
    homepage: item.homepage && item.homepage !== '' ? item.homepage : null,
    owner: item.owner.login,
    pushedAt: item.pushed_at,
    signal,
  };
}

async function readmeSearch(gh: Gh, phrase: string, since: string, signal: Signal, perPage: number): Promise<Candidate[]> {
  const out = await gh([
    'search/repositories',
    ...query(`"${phrase}" in:readme pushed:>${since}`, ['-f', 'sort=updated', '-f', 'order=desc', '-f', `per_page=${perPage}`]),
  ]);
  const items = (JSON.parse(out) as { items?: RepoItem[] }).items ?? [];
  return items.flatMap((i) => toCandidate(i, signal) ?? []);
}

/** Code search hits carry only the repository name; the repository record comes from a second call. */
async function codeSearch(gh: Gh, q: string, signal: Signal, perPage: number): Promise<Candidate[]> {
  const out = await gh(['search/code', ...query(q, ['-f', `per_page=${perPage}`])]);
  const names = [...new Set(((JSON.parse(out) as { items?: { repository: { full_name: string } }[] }).items ?? []).map((i) => i.repository.full_name))];
  const found: Candidate[] = [];
  for (const name of names) {
    const item = JSON.parse(await gh([`repos/${name}`])) as RepoItem;
    const candidate = toCandidate(item, signal);
    if (candidate) found.push(candidate);
  }
  return found;
}

/** Newest push first, per signal. Public repos only: private ones never show in search, and are dropped if they do. */
export async function discover(gh: Gh, signals: Signal[], since: string, perSignal: number): Promise<Candidate[]> {
  const byName = new Map<string, Candidate>();
  const lists: Candidate[][] = [];
  for (const signal of signals) {
    let list: Candidate[] = [];
    if (signal === 'LOVABLE') {
      list = await readmeSearch(gh, 'Welcome to your Lovable project', since, signal, perSignal);
    } else if (signal === 'V0') {
      list = await readmeSearch(gh, 'Automatically synced with your v0', since, signal, perSignal);
    } else if (signal === 'BOLT') {
      list = await codeSearch(gh, 'path:.bolt filename:config.json', signal, perSignal);
    } else {
      list = await codeSearch(gh, 'filename:.replit', signal, perSignal);
    }
    lists.push(list.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt)));
  }
  // Interleave so one signal's volume does not starve the others when the scan budget is capped.
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const c = list[i];
      if (c && !byName.has(c.fullName)) byName.set(c.fullName, c);
    }
  }
  return [...byName.values()];
}

/** More than `min` commits, read as one page of `min + 1` because a depth-1 clone cannot count them. */
export async function hasMoreCommits(gh: Gh, fullName: string, min: number): Promise<boolean> {
  try {
    const commits = JSON.parse(await gh([`repos/${fullName}/commits`, '-X', 'GET', '-f', `per_page=${min + 1}`])) as unknown[];
    return commits.length > min;
  } catch {
    return false;
  }
}

export interface RepoFiles {
  paths: string[];
  packageJsons: string[];
}

/** File paths from the git tree and up to a few package.json bodies, so the product filter runs before any clone. */
export async function readRepoFiles(gh: Gh, fullName: string, maxPackageJsons = 5): Promise<RepoFiles | null> {
  try {
    const tree = JSON.parse(await gh([`repos/${fullName}/git/trees/HEAD`, '-X', 'GET', '-f', 'recursive=1'])) as {
      tree?: { path: string; type: string }[];
    };
    const paths = (tree.tree ?? []).filter((t) => t.type === 'blob').map((t) => t.path);
    const packagePaths = paths.filter((p) => p === 'package.json' || (p.endsWith('/package.json') && !p.includes('node_modules/'))).slice(0, maxPackageJsons);
    const packageJsons: string[] = [];
    for (const p of packagePaths) {
      const file = JSON.parse(await gh([`repos/${fullName}/contents/${p}`])) as { content?: string };
      if (file.content) packageJsons.push(Buffer.from(file.content, 'base64').toString('utf8'));
    }
    return { paths, packageJsons };
  } catch {
    return null;
  }
}

export interface OwnerContact {
  contactEmail: string | null;
  contactBlog: string | null;
  contactTwitter: string | null;
}

/** The owner's public profile fields only. Commit-author emails are never read. */
export async function ownerContact(gh: Gh, owner: string): Promise<OwnerContact> {
  try {
    const user = JSON.parse(await gh([`users/${owner}`])) as { email?: string | null; blog?: string | null; twitter_username?: string | null };
    const clean = (v: string | null | undefined): string | null => (v && v.trim() !== '' ? v.trim() : null);
    return { contactEmail: clean(user.email), contactBlog: clean(user.blog), contactTwitter: clean(user.twitter_username) };
  } catch {
    return { contactEmail: null, contactBlog: null, contactTwitter: null };
  }
}
