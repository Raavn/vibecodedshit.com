import type { TestRunnerName } from '../types.js';

const SEGMENT = /&&|\|\||;|\|/;

/** Where each runner appears in a `test` script. */
export const RUNNER_PATTERN: Record<Exclude<TestRunnerName, 'pytest'>, RegExp> = {
  vitest: /\bvitest\b/,
  jest: /\bjest\b/,
  mocha: /\bmocha\b/,
  'node-test': /\bnode\b(?:\s+\S+)*?\s--test\b/,
};

/** The runner a script names; when it names several, the first one in the text. */
export function runnerInScript(script: string): Exclude<TestRunnerName, 'pytest'> | null {
  let best: { runner: Exclude<TestRunnerName, 'pytest'>; index: number } | null = null;
  for (const [runner, pattern] of Object.entries(RUNNER_PATTERN) as [Exclude<TestRunnerName, 'pytest'>, RegExp][]) {
    const index = pattern.exec(script)?.index;
    if (index !== undefined && (best === null || index < best.index)) best = { runner, index };
  }
  return best?.runner ?? null;
}

const DROP_FLAG = /^(?:--watch\S*|-w|--reporter(?:=.*)?|-R|--outputFile(?:=.*)?|--json|--ci|--coverage(?:\..*)?(?:=.*)?|--collectCoverage\S*|--run)$/;
const VALUE_FLAG = new Set(['--reporter', '-R', '--outputFile']);

/**
 * The arguments after the runner in the first segment of the script that names it (a segment ends at
 * `&&`, `||`, `;` or `|`), without watch, reporter, output and coverage options. Positional arguments
 * and `--config`, `--project`, `--dir` stay. A leading `run` (vitest) and a `--test` flag (node) are the runner itself.
 */
export function scriptArgs(script: string, runner: Exclude<TestRunnerName, 'pytest'>): string[] {
  for (const segment of script.split(SEGMENT)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const at = tokens.findIndex((token) => (runner === 'node-test' ? token === '--test' : new RegExp(`(?:^|/)${runner}$`).test(token)));
    if (at < 0) continue;
    const rest = tokens.slice(at + 1);
    const kept: string[] = [];
    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i] as string;
      if (i === 0 && runner === 'vitest' && (token === 'run' || token === 'watch' || token === 'dev')) continue;
      if (DROP_FLAG.test(token)) {
        if (VALUE_FLAG.has(token) && rest[i + 1] !== undefined && !(rest[i + 1] as string).startsWith('-')) i += 1;
        continue;
      }
      kept.push(token);
    }
    return kept;
  }
  return [];
}
