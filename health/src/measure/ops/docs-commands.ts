import { splitSimple, tokenize } from '../../scripts/expand.js';

export interface DocCommand {
  /** 1-based line of the candidate in the file. */
  line: number;
  /** The simple commands of the candidate, in order, each with the directory changes before it already applied. */
  text: string;
  /** Working directory relative to the document's own directory, changed by `cd <literal> &&`. */
  cd: string;
  tokens: string[];
}

export interface DocWords {
  /** Package manager words of the 6.6 YAML plus the recognised tool words of `script_resolution`. */
  commandWords: Set<string>;
}

const ALIASES: Record<string, string[]> = { bunx: ['npx'], uvx: ['uv', 'run'], pip3: ['pip'], python3: ['python'] };
const SKIPPED = new Set(['sudo']);

/** First word of a simple command after `VAR=value` words and `sudo`; aliases (`bunx`, `uvx`, `pip3`, `python3`) map to their base word. */
export function leadWord(tokens: string[]): { word: string; rest: string[] } | undefined {
  let rest = tokens;
  while (rest[0] !== undefined && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0]) || SKIPPED.has(rest[0]))) rest = rest.slice(1);
  const first = rest[0];
  if (first === undefined) return undefined;
  const alias = ALIASES[first];
  if (alias) rest = [...alias, ...rest.slice(1)];
  return { word: rest[0] as string, rest };
}

/** Candidates from fenced blocks (every line) and inline code spans (one per span), before splitting into simple commands. */
export function candidates(text: string): { line: number; text: string; inline: boolean }[] {
  const out: { line: number; text: string; inline: boolean }[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (marker !== undefined) {
      fence = fence === undefined ? marker[0] : fence === marker[0] ? undefined : fence;
      continue;
    }
    if (fence === undefined) {
      for (const span of line.matchAll(/`+([^`\n]+)`+/g)) out.push({ line: i + 1, text: (span[1] ?? '').trim(), inline: true });
      continue;
    }
    let candidate = line.trim();
    const start = i + 1;
    while (candidate.endsWith('\\') && i + 1 < lines.length) {
      i += 1;
      candidate = `${candidate.slice(0, -1).trimEnd()} ${(lines[i] ?? '').trim()}`;
    }
    candidate = candidate.replace(/^[$>]\s+/, '');
    if (candidate === '' || candidate.startsWith('#')) continue;
    out.push({ line: start, text: candidate, inline: false });
  }
  return out;
}

/**
 * The documented commands of a file. A command is a simple command whose first word is a package manager or recognised tool.
 * An inline span is a candidate only when it has a space (`npm` alone is not a command; `package.json` and `src/index.ts` are not).
 */
export function extractCommands(text: string, words: DocWords): DocCommand[] {
  const out: DocCommand[] = [];
  for (const candidate of candidates(text)) {
    if (candidate.inline && !/\s/.test(candidate.text)) continue;
    let cd = '.';
    for (const simple of splitSimple(candidate.text)) {
      const tokens = tokenize(simple.text);
      const lead = leadWord(tokens);
      if (!lead) continue;
      if (lead.word === 'cd' && lead.rest[1] !== undefined && !/[$`*?]/.test(lead.rest[1])) {
        if (simple.sep === '&&') cd = cd === '.' ? lead.rest[1].replace(/^\.\//, '') : `${cd}/${lead.rest[1]}`;
        continue;
      }
      if (!words.commandWords.has(lead.word)) continue;
      out.push({ line: candidate.line, text: simple.text.trim(), cd, tokens: [lead.word, ...lead.rest.slice(1)] });
    }
  }
  return out;
}
