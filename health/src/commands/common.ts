import type { Prompter } from '../interactive/prompt.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  /** Set when stdin and stdout are a terminal: the scan asks before Docker setup, submitting and a quote request. */
  prompt?: Prompter;
}

export const EXIT = { ok: 0, usage: 1, methodology: 2, noLogic: 3, tool: 4, diffRefused: 5, sendFailed: 6 } as const;
