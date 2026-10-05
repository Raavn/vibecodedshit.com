import path from 'node:path';
/** Tool output paths are `/work/...` or relative to the step's directory; map both to repo-relative. */
export function toRepoPath(reported, stepDir) {
    const posix = reported.split(path.sep).join('/').replace(/^\.\//, '');
    const rel = posix.startsWith('/work/') ? posix.slice('/work/'.length) : posix.startsWith('/') ? null : path.posix.join(stepDir, posix);
    return rel === null ? posix : path.posix.normalize(rel);
}
/** tsc `--pretty false`: `path(line,col): error TSnnnn: ...`. An error with no location is a config error, not a finding. */
export function parseTsc(text, stepDir) {
    const files = [];
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        const located = /^(.+?)\(\d+,\d+\): error TS\d+:/.exec(line);
        if (located?.[1])
            files.push(toRepoPath(located[1], stepDir));
        else if (/^error TS\d+:/.test(line))
            return null;
    }
    return { files };
}
/** mypy text output: `path:line: error: ...` or `path:line:col: error: ...`. */
export function parseMypy(text, stepDir) {
    const files = [];
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        const match = /^(.+?):\d+:(?:\d+:)? error:/.exec(line);
        if (match?.[1])
            files.push(toRepoPath(match[1], stepDir));
    }
    return { files };
}
function json(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
/** `pyright --outputjson`: `generalDiagnostics` entries of severity error. Duplicates (same place and rule) count once. */
export function parsePyright(text, stepDir) {
    const doc = json(text);
    if (!doc || !Array.isArray(doc.generalDiagnostics))
        return null;
    const seen = new Set();
    const files = [];
    for (const entry of doc.generalDiagnostics) {
        if (entry.severity !== 'error' || typeof entry.file !== 'string')
            continue;
        const key = `${entry.file}:${entry.range?.start?.line ?? 0}:${entry.range?.start?.character ?? 0}:${entry.rule ?? entry.message ?? ''}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        files.push(toRepoPath(entry.file, stepDir));
    }
    return { files };
}
/** `eslint -f json`: every message is a finding, including a parse error (no rule id), which counts as one. */
export function parseEslint(text, stepDir) {
    const doc = json(text);
    if (!Array.isArray(doc))
        return null;
    const files = [];
    for (const entry of doc) {
        if (typeof entry.filePath !== 'string')
            return null;
        for (let i = 0; i < (entry.messages?.length ?? 0); i += 1)
            files.push(toRepoPath(entry.filePath, stepDir));
    }
    return { files };
}
/** `ruff check --output-format json`: one entry per finding, a syntax error included. */
export function parseRuff(text, stepDir) {
    const doc = json(text);
    if (!Array.isArray(doc))
        return null;
    const files = [];
    for (const entry of doc) {
        if (typeof entry.filename !== 'string')
            return null;
        files.push(toRepoPath(entry.filename, stepDir));
    }
    return { files };
}
/** Exit codes that mean "ran and reported findings", per tool. Anything else is a config or tool failure of the repository. */
export const NORMAL_EXIT = {
    tsc: [0, 1, 2],
    pyright: [0, 1],
    mypy: [0, 1],
    eslint: [0, 1],
    ruff: [0, 1],
};
