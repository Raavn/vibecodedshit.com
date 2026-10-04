import type { D6Lists } from '../methodology/load.js';
import type { ResolvedCommand } from './types.js';

export type CheckKind = 'typecheck' | 'lint' | 'test';
export type RecognisedTools = Pick<D6Lists, 'typecheckers' | 'linters' | 'testRunners'>;

const INFO_FLAGS = new Set(['--help', '--version', '-h', '-V']);
const TSC_NON_CHECKS = new Set(['--init', '--help', '--version', '-v', '-h']);
const BIOME_CHECKS = new Set(['check', 'lint', 'ci']);

/** Tools that run checks the methodology does not recognise (a finding on 6.2). */
export const UNRECOGNISED_RUNNERS = new Set(['turbo', 'nx', 'lerna', 'next', 'ng', 'react-scripts']);

/** `python -m unittest` is the tool `unittest` once its prefix is removed; `node --test` is the tool `node` with that flag. */
function testToolNames(rec: RecognisedTools): { tools: Set<string>; nodeTest: boolean } {
  const tools = new Set<string>();
  let nodeTest = false;
  for (const entry of rec.testRunners) {
    if (entry === 'node --test') nodeTest = true;
    else tools.add(entry.replace(/^python3? -m /, ''));
  }
  return { tools, nodeTest };
}

/**
 * The checks a command runs, by tool, after prefix removal. A check is recognised by tool, not by language group, so `tsc` counts
 * for a Python unit in a mixed package and `mypy` for a TypeScript one.
 */
export function checkKinds(cmd: ResolvedCommand, rec: RecognisedTools): Set<CheckKind> {
  const out = new Set<CheckKind>();
  const tool = cmd.tool;
  if (tool === null) return out;
  if (cmd.argv.some((a) => INFO_FLAGS.has(a))) return out;
  const first = cmd.argv.find((a) => !a.startsWith('-'));
  if (rec.typecheckers.includes(tool)) {
    if (tool === 'tsc' && cmd.argv.some((a) => TSC_NON_CHECKS.has(a))) return out;
    out.add('typecheck');
    return out;
  }
  if (rec.linters.includes(tool)) {
    if (tool === 'ruff' && first === 'format') return out;
    if (tool === 'biome' && !(first !== undefined && BIOME_CHECKS.has(first))) return out;
    out.add('lint');
    return out;
  }
  const { tools, nodeTest } = testToolNames(rec);
  if (tool === 'tox' || tool === 'nox') {
    if (tools.has(tool) && cmd.readable !== true) out.add('test');
    return out;
  }
  if (tools.has(tool) || (nodeTest && tool === 'node' && cmd.argv.includes('--test'))) out.add('test');
  return out;
}
