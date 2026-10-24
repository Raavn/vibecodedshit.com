import path from 'node:path';
import { ciCommands } from './ci.js';
import { entryPointKind } from './entry-points/index.js';
const SKIPPED_WORDS = new Set(['sudo', 'time', 'exec', 'env', 'command', 'nohup']);
export const RUNNER_PREFIXES = [
    ['pnpm', 'exec'], ['pnpm', 'dlx'], ['yarn', 'exec'], ['yarn', 'dlx'], ['uv', 'run'], ['poetry', 'run'], ['pdm', 'run'],
    ['hatch', 'run'], ['pipx', 'run'], ['python', '-m'], ['python3', '-m'], ['npx'], ['bunx'], ['yarn'], ['pnpm'],
];
/** Split on newline, `&&`, `||`, `;` and `|` outside quotes. */
export function splitSimple(text) {
    const out = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote !== null) {
            if (ch === quote)
                quote = null;
            current += ch;
        }
        else if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
        }
        else if (ch === '\\' && text[i + 1] === '\n') {
            i += 1;
        }
        else if ((ch === '&' && text[i + 1] === '&') || (ch === '|' && text[i + 1] === '|')) {
            out.push({ text: current, sep: ch + ch });
            current = '';
            i += 1;
        }
        else if (ch === ';' || ch === '|' || ch === '\n') {
            out.push({ text: current, sep: ch });
            current = '';
        }
        else
            current += ch;
    }
    out.push({ text: current, sep: '' });
    return out.filter((s) => s.text.trim() !== '');
}
export function tokenize(text) {
    const tokens = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    for (let m = re.exec(text); m !== null; m = re.exec(text))
        tokens.push(m[1] ?? m[2] ?? m[3] ?? '');
    return tokens;
}
function stripWrappers(tokens) {
    let rest = tokens;
    for (;;) {
        const first = rest[0];
        if (first === undefined)
            return rest;
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first) || SKIPPED_WORDS.has(first)) {
            rest = rest.slice(1);
            continue;
        }
        return rest;
    }
}
function stripRunners(tokens) {
    let rest = tokens;
    for (;;) {
        const prefix = RUNNER_PREFIXES.find((p) => p.every((word, i) => rest[i] === word));
        if (!prefix)
            return rest;
        rest = rest.slice(prefix.length);
        while (rest[0]?.startsWith('-'))
            rest = rest.slice(1);
    }
}
/** Flags that take a value, for the runners whose first plain argument is the script or target name. */
const VALUE_FLAGS = new Set(['--prefix', '-C', '--cwd', '--filter', '-F', '--workspace', '--directory']);
function joinDir(dir, next) {
    return next === undefined ? dir : path.posix.normalize(path.posix.join(dir, next));
}
function detectPackageManager(base, tokens, dir) {
    let callDir = dir;
    const args = [];
    for (let i = 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token === '--prefix' || token === '-C' || token === '--cwd') {
            callDir = joinDir(dir, tokens[i + 1]);
            i += 1;
        }
        else if (token.startsWith('--prefix='))
            callDir = joinDir(dir, token.slice(9));
        else if (VALUE_FLAGS.has(token))
            i += 1;
        else if (token.startsWith('-'))
            continue;
        else
            args.push(token);
    }
    let name;
    let fallback = false;
    if (base === 'npm') {
        if (args[0] === 'run' || args[0] === 'run-script')
            name = args[1];
        else if (args[0] === 'test' || args[0] === 'start')
            name = args[0];
    }
    else if (base === 'bun') {
        if (args[0] === 'run')
            name = args[1];
    }
    else if (args[0] === 'run')
        name = args[1];
    else if (args[0] !== undefined && !(base === 'pnpm' && (args[0] === 'exec' || args[0] === 'dlx')) && !(base === 'yarn' && (args[0] === 'exec' || args[0] === 'dlx'))) {
        name = args[0];
        fallback = true;
    }
    if (name === undefined)
        return undefined;
    return { runner: base, kind: 'package-json', names: [name], dir: callDir, prePost: base === 'npm' || base === 'yarn', fallback };
}
function detectMake(base, tokens, dir) {
    let callDir = dir;
    const targets = [];
    for (let i = 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token === '-C' || token === '--directory') {
            callDir = joinDir(dir, tokens[i + 1]);
            i += 1;
        }
        else if (token === '-f' || token === '--file')
            i += 1;
        else if (token.startsWith('-') || token.includes('='))
            continue;
        else
            targets.push(token);
    }
    if (targets.length === 0)
        return undefined;
    return { runner: base, kind: 'makefile', names: targets, dir: callDir, prePost: false, fallback: false };
}
function detectJust(tokens, dir) {
    let callDir = dir;
    const names = [];
    for (let i = 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token === '-d' || token === '--working-directory') {
            callDir = joinDir(dir, tokens[i + 1]);
            i += 1;
        }
        else if (token === '-f' || token === '--justfile')
            i += 1;
        else if (token.startsWith('--justfile=') || token.startsWith('--working-directory='))
            continue;
        else if (token.startsWith('-') || token.includes('='))
            continue;
        else
            names.push(token);
    }
    return { runner: 'just', kind: 'justfile', names: names.length === 0 ? ['@default'] : names, dir: callDir, prePost: false, fallback: false };
}
function detectTox(tokens, dir) {
    const names = [];
    for (let i = 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token === '--')
            break;
        if (token === '-e') {
            names.push(...(tokens[i + 1] ?? '').split(','));
            i += 1;
        }
        else if (token.startsWith('-e') && token.length > 2)
            names.push(...token.slice(2).split(','));
    }
    return { runner: 'tox', kind: 'tox', names: names.length === 0 ? ['@default'] : names.filter((n) => n !== ''), dir, prePost: false, fallback: false };
}
function detectNox(tokens, dir) {
    const names = [];
    for (let i = 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token === '--')
            break;
        if (token === '-s' || token === '--session' || token === '-e' || token === '--sessions') {
            while (tokens[i + 1] !== undefined && !tokens[i + 1].startsWith('-')) {
                names.push(...tokens[i + 1].split(','));
                i += 1;
            }
        }
    }
    return { runner: 'nox', kind: 'nox', names: names.length === 0 ? ['@all'] : names.filter((n) => n !== ''), dir, prePost: false, fallback: false };
}
/** `uv run <n>`, `poetry run <n>`, `pdm run <n>`, `hatch run [<env>:]<n>`, `rye run <n>`, `poe <n>` and `task <n>` name a script of a pyproject table. */
function detectPyproject(tokens, dir) {
    const [first, second] = tokens;
    const rest = (from) => tokens.slice(from).find((t) => !t.startsWith('-'));
    const make = (runner, key, name, fallback) => name === undefined ? undefined : { runner, kind: 'pyproject', names: [key(name)], dir, prePost: false, fallback };
    if ((first === 'uv' || first === 'poetry') && second === 'run')
        return make(first, (n) => `scripts:${n}`, rest(2), true);
    if (first === 'pdm' && second === 'run')
        return make(first, (n) => `pdm:${n}`, rest(2), true);
    if (first === 'hatch' && second === 'run')
        return make(first, (n) => (n.includes(':') ? `hatch:${n}` : `hatch:default:${n}`), rest(2), true);
    if (first === 'rye' && second === 'run')
        return make(first, (n) => `rye:${n}`, rest(2), false);
    if (first === 'poe')
        return make(first, (n) => `poe:${n}`, rest(1), false);
    if (first === 'task')
        return make(first, (n) => `taskipy:${n}`, rest(1), false);
    return undefined;
}
function detectCall(tokens, dir) {
    const first = tokens[0];
    if (first === undefined)
        return undefined;
    const base = path.posix.basename(first);
    if (base === 'npm' || base === 'yarn' || base === 'pnpm' || base === 'bun')
        return detectPackageManager(base, tokens, dir);
    if (base === 'make' || first === '$(MAKE)' || first === '${MAKE}')
        return detectMake('make', tokens, dir);
    if (base === 'just')
        return detectJust(tokens, dir);
    if (base === 'tox')
        return detectTox(tokens, dir);
    if (base === 'nox')
        return detectNox(tokens, dir);
    return detectPyproject(tokens, dir);
}
function expandText(repoPath, text, frame, maxDepth, out) {
    let dir = frame.dir;
    for (const simple of splitSimple(text)) {
        const tokens = stripWrappers(tokenize(simple.text));
        if (tokens.length === 0)
            continue;
        if (tokens[0] === 'cd' && tokens[1] !== undefined && !/[$`*?]/.test(tokens[1])) {
            if (simple.sep === '&&')
                dir = path.posix.normalize(path.posix.join(dir, tokens[1]));
            continue;
        }
        const call = detectCall(tokens, dir);
        if (call && follow(repoPath, call, tokens, frame, maxDepth, out))
            continue;
        const stripped = stripRunners(tokens);
        const [tool, ...argv] = stripped;
        out.push({ tool: tool === undefined ? null : path.posix.basename(tool), argv, file: frame.file, chain: frame.chain, depth: frame.chain.length });
    }
}
/** Replace a call by what it runs. False when the caller should read the command another way (runner prefix removed). */
function follow(repoPath, call, tokens, frame, maxDepth, out) {
    const kind = entryPointKind(call.kind);
    const plain = () => {
        if (call.fallback && frame.chain.length < maxDepth)
            return false;
        const readable = kind?.fileFor === undefined ? undefined : kind.fileFor(repoPath, call.dir) !== undefined;
        out.push({
            tool: call.runner,
            argv: tokens.slice(1),
            file: frame.file,
            chain: frame.chain,
            depth: frame.chain.length,
            ...(readable === undefined ? {} : { readable }),
        });
        return true;
    };
    if (!kind || frame.chain.length >= maxDepth)
        return plain();
    let followed = false;
    for (const name of call.names) {
        const variants = call.prePost ? [`pre${name}`, name, `post${name}`] : [name];
        for (const variant of variants) {
            const found = kind.lookup(repoPath, call.dir, variant);
            const key = found ? `${found.file}:${variant}` : '';
            if (!found || frame.seen.has(key))
                continue;
            followed = true;
            const next = {
                dir: path.posix.dirname(found.file),
                file: found.file,
                chain: [...frame.chain, key],
                seen: new Set([...frame.seen, key]),
            };
            for (const body of found.bodies)
                expandText(repoPath, body, next, maxDepth, out);
        }
    }
    return followed || plain();
}
/** The commands a text runs, calls to scripts and make targets replaced by what they run (up to `maxDepth` bodies deep, default 3). */
export function expandCommand(repoPath, text, from, opts = {}) {
    const out = [];
    expandText(repoPath, text, { dir: from.dir, file: from.file, chain: [], seen: new Set() }, opts.maxDepth ?? 3, out);
    return out;
}
/** Every CI command whose expansion reaches one of `tools`. */
export function ciInvokes(repoPath, tools, opts = {}) {
    const hits = [];
    for (const command of ciCommands(repoPath, opts.warnings)) {
        const resolved = expandCommand(repoPath, command.command, { dir: command.dir, file: command.file }, opts);
        const match = resolved.find((r) => r.tool !== null && tools.includes(r.tool));
        if (match)
            hits.push({ file: command.file, job: command.job, chain: match.chain });
    }
    return hits;
}
