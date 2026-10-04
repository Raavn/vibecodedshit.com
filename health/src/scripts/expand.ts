import path from 'node:path';
import { ciCommands } from './ci.js';
import { entryPointKind } from './entry-points/index.js';
import type { ResolvedCommand } from './types.js';

const SKIPPED_WORDS = new Set(['sudo', 'time', 'exec', 'env', 'command', 'nohup']);
const RUNNER_PREFIXES: string[][] = [
  ['pnpm', 'exec'], ['pnpm', 'dlx'], ['yarn', 'exec'], ['yarn', 'dlx'], ['uv', 'run'], ['poetry', 'run'], ['pdm', 'run'],
  ['hatch', 'run'], ['pipx', 'run'], ['python', '-m'], ['python3', '-m'], ['npx'], ['bunx'],
];

interface Simple {
  text: string;
  /** The separator that follows the command. */
  sep: string;
}

/** Split on newline, `&&`, `||`, `;` and `|` outside quotes. */
function splitSimple(text: string): Simple[] {
  const out: Simple[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '\\' && text[i + 1] === '\n') {
      i += 1;
    } else if ((ch === '&' && text[i + 1] === '&') || (ch === '|' && text[i + 1] === '|')) {
      out.push({ text: current, sep: ch + ch });
      current = '';
      i += 1;
    } else if (ch === ';' || ch === '|' || ch === '\n') {
      out.push({ text: current, sep: ch });
      current = '';
    } else current += ch;
  }
  out.push({ text: current, sep: '' });
  return out.filter((s) => s.text.trim() !== '');
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) tokens.push(m[1] ?? m[2] ?? m[3] ?? '');
  return tokens;
}

function stripWrappers(tokens: string[]): string[] {
  let rest = tokens;
  for (;;) {
    const first = rest[0];
    if (first === undefined) return rest;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first) || SKIPPED_WORDS.has(first)) {
      rest = rest.slice(1);
      continue;
    }
    return rest;
  }
}

function stripRunners(tokens: string[]): string[] {
  let rest = tokens;
  for (;;) {
    const prefix = RUNNER_PREFIXES.find((p) => p.every((word, i) => rest[i] === word));
    if (!prefix) return rest;
    rest = rest.slice(prefix.length);
    while (rest[0]?.startsWith('-')) rest = rest.slice(1);
  }
}

interface Call {
  runner: string;
  kind: 'package-json' | 'makefile';
  names: string[];
  dir: string;
  prePost: boolean;
}

function detectCall(tokens: string[], dir: string): Call | undefined {
  const first = tokens[0];
  if (first === undefined) return undefined;
  const base = path.posix.basename(first);
  if (base === 'npm' || base === 'yarn' || base === 'pnpm' || base === 'bun') {
    let callDir = dir;
    const args: string[] = [];
    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i] as string;
      if (token === '--prefix' || token === '-C' || token === '--cwd') {
        const next = tokens[i + 1];
        if (next !== undefined) callDir = path.posix.normalize(path.posix.join(dir, next));
        i += 1;
      } else if (token.startsWith('--prefix=')) callDir = path.posix.normalize(path.posix.join(dir, token.slice(9)));
      else if (token.startsWith('-')) continue;
      else args.push(token);
    }
    let name: string | undefined;
    if (base === 'npm') {
      if (args[0] === 'run' || args[0] === 'run-script') name = args[1];
      else if (args[0] === 'test' || args[0] === 'start') name = args[0];
    } else if (base === 'bun') {
      if (args[0] === 'run') name = args[1];
    } else if (args[0] === 'run') name = args[1];
    else if (args[0] !== undefined && !(base === 'pnpm' && args[0] === 'exec')) name = args[0];
    if (name === undefined) return undefined;
    return { runner: base, kind: 'package-json', names: [name], dir: callDir, prePost: base === 'npm' || base === 'yarn' };
  }
  if (base === 'make' || first === '$(MAKE)' || first === '${MAKE}') {
    let callDir = dir;
    const targets: string[] = [];
    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i] as string;
      if (token === '-C' || token === '--directory') {
        const next = tokens[i + 1];
        if (next !== undefined) callDir = path.posix.normalize(path.posix.join(dir, next));
        i += 1;
      } else if (token === '-f' || token === '--file') i += 1;
      else if (token.startsWith('-') || token.includes('=')) continue;
      else targets.push(token);
    }
    if (targets.length === 0) return undefined;
    return { runner: 'make', kind: 'makefile', names: targets, dir: callDir, prePost: false };
  }
  return undefined;
}

interface Frame {
  dir: string;
  file: string;
  chain: string[];
  seen: Set<string>;
}

function expandText(repoPath: string, text: string, frame: Frame, maxDepth: number, out: ResolvedCommand[]): void {
  let dir = frame.dir;
  for (const simple of splitSimple(text)) {
    const tokens = stripWrappers(tokenize(simple.text));
    if (tokens.length === 0) continue;
    if (tokens[0] === 'cd' && tokens[1] !== undefined && !/[$`*?]/.test(tokens[1])) {
      if (simple.sep === '&&') dir = path.posix.normalize(path.posix.join(dir, tokens[1]));
      continue;
    }
    const stripped = stripRunners(tokens);
    const call = stripped === tokens ? detectCall(tokens, dir) : undefined;
    if (call) {
      follow(repoPath, call, tokens, frame, maxDepth, out);
      continue;
    }
    const [tool, ...argv] = stripped;
    out.push({ tool: tool === undefined ? null : path.posix.basename(tool), argv, file: frame.file, chain: frame.chain, depth: frame.chain.length });
  }
}

function follow(repoPath: string, call: Call, tokens: string[], frame: Frame, maxDepth: number, out: ResolvedCommand[]): void {
  const plain = (): void =>
    void out.push({ tool: call.runner, argv: tokens.slice(1), file: frame.file, chain: frame.chain, depth: frame.chain.length });
  const kind = entryPointKind(call.kind);
  if (!kind || frame.chain.length >= maxDepth) return plain();
  let followed = false;
  for (const name of call.names) {
    const variants = call.prePost ? [`pre${name}`, name, `post${name}`] : [name];
    for (const variant of variants) {
      const found = kind.lookup(repoPath, call.dir, variant);
      const key = found ? `${found.file}:${variant}` : '';
      if (!found || frame.seen.has(key)) continue;
      followed = true;
      const next: Frame = {
        dir: path.posix.dirname(found.file),
        file: found.file,
        chain: [...frame.chain, key],
        seen: new Set([...frame.seen, key]),
      };
      for (const body of found.bodies) expandText(repoPath, body, next, maxDepth, out);
    }
  }
  if (!followed) plain();
}

/** The commands a text runs, calls to scripts and make targets replaced by what they run (up to `maxDepth` bodies deep, default 3). */
export function expandCommand(
  repoPath: string,
  text: string,
  from: { dir: string; file: string },
  opts: { maxDepth?: number } = {},
): ResolvedCommand[] {
  const out: ResolvedCommand[] = [];
  expandText(repoPath, text, { dir: from.dir, file: from.file, chain: [], seen: new Set() }, opts.maxDepth ?? 3, out);
  return out;
}

/** Every CI command whose expansion reaches one of `tools`. */
export function ciInvokes(
  repoPath: string,
  tools: string[],
  opts: { maxDepth?: number; warnings?: string[] } = {},
): { file: string; job: string; chain: string[] }[] {
  const hits: { file: string; job: string; chain: string[] }[] = [];
  for (const command of ciCommands(repoPath, opts.warnings)) {
    const resolved = expandCommand(repoPath, command.command, { dir: command.dir, file: command.file }, opts);
    const match = resolved.find((r) => r.tool !== null && tools.includes(r.tool));
    if (match) hits.push({ file: command.file, job: command.job, chain: match.chain });
  }
  return hits;
}
