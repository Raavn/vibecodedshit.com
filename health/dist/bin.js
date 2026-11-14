#!/usr/bin/env node
import { run } from './cli.js';
import { terminalPrompter } from './interactive/prompt.js';
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
const code = await run(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    ...(interactive ? { prompt: terminalPrompter } : {}),
});
process.exitCode = code;
