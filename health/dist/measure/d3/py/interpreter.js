import { closeSync, openSync, readSync } from 'node:fs';
/**
 * The Python interpreter that holds import-linter and grimp: the `#!<absolute path>` first line of the
 * resolved `lint-imports` script (a pipx or uv tool environment keeps them out of the system python3).
 * Any other first line, or an unreadable file, is unavailable; nothing falls back to the system python3.
 */
export function pyInterpreter(tool) {
    const fail = () => ({ unavailable: `import-linter: cannot read its Python interpreter from ${tool.command}` });
    let line;
    try {
        const fd = openSync(tool.command, 'r');
        try {
            const buffer = Buffer.alloc(512);
            const read = readSync(fd, buffer, 0, buffer.length, 0);
            line = buffer.toString('utf8', 0, read).split(/\r?\n/, 1)[0] ?? '';
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
        return fail();
    }
    const match = /^#!(\/\S+)$/.exec(line.trim());
    if (!match?.[1] || /(^|\/)env$/.test(match[1]))
        return fail();
    return { interpreter: match[1] };
}
