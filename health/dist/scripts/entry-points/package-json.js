import path from 'node:path';
import { readPackageJson } from '../../manifest/package-json.js';
/** `scripts` of the `package.json` in `dir`, else the nearest ancestor within the repository. */
export const packageJsonEntryPoints = {
    id: 'package-json',
    list(repoPath, dir) {
        const manifest = readPackageJson(repoPath, dir);
        return Object.keys(manifest?.scripts ?? {}).map((name) => ({ name, invoke: `npm run ${name}` }));
    },
    lookup(repoPath, dir, name) {
        for (let current = path.posix.normalize(dir === '' ? '.' : dir);; current = path.posix.dirname(current)) {
            const manifest = readPackageJson(repoPath, current);
            if (manifest) {
                const body = manifest.scripts[name];
                return body === undefined ? undefined : { file: path.posix.join(current, 'package.json'), bodies: [body] };
            }
            if (current === '.' || current === '' || current.startsWith('..'))
                return undefined;
        }
    },
};
