export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

export const EXIT = { ok: 0, usage: 1, methodology: 2, noLogic: 3, tool: 4, diffRefused: 5, key: 6 } as const;
