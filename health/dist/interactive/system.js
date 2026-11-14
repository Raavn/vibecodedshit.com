import { spawn } from 'node:child_process';
export const hostSystem = {
    platform: process.platform,
    exec: (command, args, opts = {}) => new Promise((resolve) => {
        const child = spawn(command, args, { stdio: opts.inherit ? 'inherit' : 'ignore' });
        child.on('error', () => resolve(null));
        child.on('close', (code) => resolve(code));
    }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
