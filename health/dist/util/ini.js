/**
 * Minimal INI reader for mypy's `mypy.ini`, `.mypy.ini` and `setup.cfg`: sections, `key = value`
 * and `key: value`, `;` and `#` comment lines, indented continuation lines, no interpolation.
 * Keys before any section go to the section "".
 */
export function parseIni(text) {
    const sections = {};
    let current = '';
    let lastKey;
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
        if (rawLine.trim() === '') {
            lastKey = undefined;
            continue;
        }
        if (/^\s*[;#]/.test(rawLine))
            continue;
        if (/^\s/.test(rawLine) && lastKey !== undefined) {
            const section = (sections[current] ??= {});
            section[lastKey] = `${section[lastKey] ?? ''}\n${rawLine.trim()}`;
            continue;
        }
        const header = /^\s*\[([^\]]*)\]/.exec(rawLine);
        if (header) {
            current = (header[1] ?? '').trim();
            sections[current] ??= {};
            lastKey = undefined;
            continue;
        }
        const pair = /^\s*([^=:]+?)\s*[=:]\s*(.*?)\s*$/.exec(rawLine);
        if (pair?.[1] !== undefined) {
            const section = (sections[current] ??= {});
            lastKey = pair[1];
            section[lastKey] = pair[2] ?? '';
        }
    }
    return sections;
}
