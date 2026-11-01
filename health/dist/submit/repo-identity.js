import { createHash } from 'node:crypto';
import path from 'node:path';
export class RepoIdentityError extends Error {
    constructor() {
        super('cannot determine the repository identity (run.json repo.path is missing or not a git repository)');
        this.name = 'RepoIdentityError';
    }
}
/**
 * Reduce a remote URL to `host/owner/repo`: no scheme, credentials, port, `.git` suffix or trailing slash, lowercase.
 * The SSH and HTTPS forms of one remote give the same string.
 */
export function normalizeRemote(url) {
    const trimmed = url.trim();
    const schemed = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
    const scp = /^(?:[^@/:]+@)?([^:/]+):(.+)$/.exec(trimmed);
    const match = schemed ?? scp;
    const joined = match ? `${match[1]}/${match[2]}` : trimmed;
    return joined.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export async function repoIdentity(repoPath, git) {
    if (!repoPath)
        throw new RepoIdentityError();
    const remotes = await git(repoPath, ['remote']);
    if (remotes === null)
        throw new RepoIdentityError();
    const names = remotes.split('\n').map((n) => n.trim()).filter(Boolean);
    const remote = names.includes('origin') ? 'origin' : names[0];
    if (remote !== undefined) {
        const url = (await git(repoPath, ['remote', 'get-url', remote]))?.trim();
        if (url) {
            const normalised = normalizeRemote(url);
            return { hash: sha256(normalised), name: normalised.split('/').slice(1).join('/') || normalised };
        }
    }
    const roots = await git(repoPath, ['rev-list', '--max-parents=0', 'HEAD']);
    const root = roots
        ?.split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean)
        .sort()[0];
    if (!root)
        throw new RepoIdentityError();
    return { hash: sha256(root), name: path.basename(repoPath) };
}
