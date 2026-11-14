import { spawn } from 'node:child_process';

/** The host commands the interactive setup runs. A test seam. */
export interface System {
  platform: NodeJS.Platform;
  /** Exit code, or null when the command could not start. `inherit` shows its output in the terminal. */
  exec: (command: string, args: string[], opts?: { inherit?: boolean }) => Promise<number | null>;
  sleep: (ms: number) => Promise<void>;
}

export const hostSystem: System = {
  platform: process.platform,
  exec: (command, args, opts = {}) =>
    new Promise((resolve) => {
      const child = spawn(command, args, { stdio: opts.inherit ? 'inherit' : 'ignore' });
      child.on('error', () => resolve(null));
      child.on('close', (code) => resolve(code));
    }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
