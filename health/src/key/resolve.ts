import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { keyFilePath } from './paths.js';

/** Env `VIBECODEDSHIT_KEY`, else the key file (`keyFilePath`). Whitespace-trimmed; empty after trim counts as absent. */
export function resolveKey(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string | null {
  const fromEnv = env.VIBECODEDSHIT_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = readFileSync(keyFilePath(env, home), 'utf8').trim();
    return fromFile || null;
  } catch {
    return null;
  }
}
