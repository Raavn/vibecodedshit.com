import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTE_FILE, SLICE_FILE, TASK_PLACEHOLDER } from './files.js';
/** The problems with `dir` compared to the files regenerated from run.json. Empty when the facts match and every Task is written. */
export function checkRouteFiles(dir, expected) {
    if (!existsSync(dir))
        return [`${dir} does not exist`];
    const problems = [];
    const known = new Set(expected.map((f) => f.name));
    for (const name of readdirSync(dir)) {
        if ((name === ROUTE_FILE || SLICE_FILE.test(name)) && !known.has(name))
            problems.push(`${name}: not part of this Route`);
    }
    for (const file of expected) {
        const full = path.join(dir, file.name);
        if (!existsSync(full)) {
            problems.push(`${file.name}: missing`);
            continue;
        }
        const actual = readFileSync(full, 'utf8');
        if (!actual.startsWith(file.fixed)) {
            problems.push(`${file.name}: facts differ from run.json`);
            continue;
        }
        if (file.name === ROUTE_FILE) {
            if (actual !== file.content)
                problems.push(`${file.name}: facts differ from run.json`);
            continue;
        }
        const task = actual.slice(file.fixed.length);
        if (task.includes(TASK_PLACEHOLDER))
            problems.push(`${file.name}: Task placeholder not replaced`);
        else if (task.trim() === '')
            problems.push(`${file.name}: Task is empty`);
    }
    return problems;
}
