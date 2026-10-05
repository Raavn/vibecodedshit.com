import path from 'node:path';
import { noxSessions } from '../../python/nox.js';
import { trackedPaths } from '../../scope/tracked.js';
function noxfileIn(repoPath, dir) {
    const file = path.posix.join(dir === '' ? '.' : dir, 'noxfile.py');
    return trackedPaths(repoPath).includes(file) ? file : undefined;
}
/** `noxfile.py` in `dir`. A call is `nox [-s <sessions>]`; without `-s` every session runs. */
export const noxEntryPoints = {
    id: 'nox',
    fileFor: noxfileIn,
    list(repoPath, dir) {
        const file = noxfileIn(repoPath, dir);
        const sessions = file ? noxSessions(repoPath, file) : undefined;
        return (sessions ?? []).map((s) => ({ name: s.name, invoke: `nox -s ${s.name}` }));
    },
    lookup(repoPath, dir, name) {
        const file = noxfileIn(repoPath, dir);
        const sessions = file ? noxSessions(repoPath, file) : undefined;
        if (!file || !sessions)
            return undefined;
        if (name === '@all')
            return { file, bodies: sessions.flatMap((s) => s.commands) };
        const session = sessions.find((s) => s.name === name);
        if (!session)
            return undefined;
        return { file, bodies: [...session.notify.map((n) => `nox -s ${n}`), ...session.commands] };
    },
};
