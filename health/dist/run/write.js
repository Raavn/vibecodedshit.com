import { writeFileSync } from 'node:fs';
export function writeRun(file, run) {
    writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
}
