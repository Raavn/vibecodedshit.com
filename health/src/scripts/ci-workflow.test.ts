import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureFiles, unitsOf } from '../../test/helpers/measure.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(path.resolve(here, '../../../.github/workflows/ci.yml'), 'utf8');
const manifest = readFileSync(path.resolve(here, '../../package.json'), 'utf8');

describe('repository CI workflow', () => {
  it('6.4 reads typecheck, lint and test for the root unit from .github/workflows/ci.yml', async () => {
    const units = unitsOf(await measureFiles('6.4', { 'health/src/a.ts': 'export function f() { return 1; }\n', 'health/package.json': manifest, '.github/workflows/ci.yml': workflow }));
    expect(units.map((u) => [u.package, u.raw])).toEqual([['.', { kind: 'level', level: '3' }]]);
  });
});
