import { homedir } from 'node:os';
import path from 'node:path';

/** `$XDG_CONFIG_HOME/vibecodedshit/key`, or `~/.config/vibecodedshit/key` when `XDG_CONFIG_HOME` is unset, empty or relative. */
export function keyFilePath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, '.config');
  return path.join(base, 'vibecodedshit', 'key');
}
