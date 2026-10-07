import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { keyFilePath } from '../key/paths.js';
import { EXIT, type CliIo } from './common.js';

export const KEY_USAGE = 'Usage: health key set <key>\n';

export interface KeySetDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function runKeySet(argv: string[], io: CliIo, deps: KeySetDeps = {}): number {
  const [sub, value] = argv;
  if (sub !== 'set' || !value || argv.length > 2) {
    io.stderr(KEY_USAGE);
    return EXIT.usage;
  }
  if (!value.startsWith('vcs_')) {
    io.stderr('Key must start with "vcs_".\n');
    return EXIT.usage;
  }
  const file = keyFilePath(deps.env ?? process.env, deps.home);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${value}\n`, 'utf8');
  chmodSync(file, 0o600);
  io.stdout(`Saved vibecodedshit key to ${file}\n`);
  return EXIT.ok;
}
