import { createInterface } from 'node:readline/promises';
async function ask(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await rl.question(question)).trim();
    }
    finally {
        rl.close();
    }
}
export const terminalPrompter = {
    async confirm(question) {
        const answer = await ask(`${question} [y/N] `);
        return /^y(es)?$/i.test(answer);
    },
    text: (question) => ask(`${question} `),
};
