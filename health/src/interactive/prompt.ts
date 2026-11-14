import { createInterface } from 'node:readline/promises';

/** Questions asked in a terminal. `confirm` defaults to No. */
export interface Prompter {
  confirm: (question: string) => Promise<boolean>;
  text: (question: string) => Promise<string>;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export const terminalPrompter: Prompter = {
  async confirm(question) {
    const answer = await ask(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer);
  },
  text: (question) => ask(`${question} `),
};
