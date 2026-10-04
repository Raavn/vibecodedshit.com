import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createToolKit, type ResolvedTool } from '../src/tools/kit.js';
import { knipRoots } from '../src/tools/knip.js';
import { createWorkCopy } from '../src/tools/workcopy.js';
import { readToml } from '../src/util/toml.js';
import { materializeFixture } from './helpers/fixture.js';

const node = (): ResolvedTool => ({ name: 'jscpd', command: process.execPath, prefixArgs: [], version: 'x' });

describe('tool kit', () => {
  it('resolves npm tools from node_modules with the version of their package.json', async () => {
    const kit = createToolKit();
    const jscpd = await kit.resolve('jscpd');
    expect(jscpd?.command).toBe(process.execPath);
    expect(jscpd?.prefixArgs[0]).toMatch(/node_modules[\\/]jscpd[\\/]/);
    expect(jscpd?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(kit.versions().jscpd).toBe(jscpd?.version);
  });

  it('finds PATH tools without a shell and reads their version', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'health-bin-'));
    const exe = path.join(dir, 'vulture');
    writeFileSync(exe, '#!/bin/sh\necho "vulture 2.14"\n');
    chmodSync(exe, 0o755);
    const kit = createToolKit({ env: { PATH: dir } });
    const vulture = await kit.resolve('vulture');
    expect(vulture).toMatchObject({ name: 'vulture', command: exe, version: '2.14' });
    expect(await createToolKit({ env: { PATH: dir } }).resolve('complexipy')).toBeUndefined();
    expect(await createToolKit({ env: { PATH: '' } }).resolve('vulture')).toBeUndefined();
  });

  it('runs a process and captures output, exit code and a timeout', async () => {
    const kit = createToolKit();
    const cwd = tmpdir();
    const done = await kit.run(node(), ['-e', 'console.log("out"); console.error("err"); process.exit(3)'], { cwd });
    expect(done).toMatchObject({ exitCode: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false });
    const slow = await kit.run(node(), ['-e', 'setInterval(() => {}, 1000)'], { cwd, timeoutMs: 100 });
    expect(slow.timedOut).toBe(true);
    const missing = await kit.run({ ...node(), command: '/nonexistent/tool' }, [], { cwd });
    expect(missing.spawnError).toBeDefined();
    expect(missing.exitCode).toBeNull();
  });

  it('memoizes by key and records versions in name order', async () => {
    const kit = createToolKit();
    let calls = 0;
    const make = async (): Promise<number> => ++calls;
    expect(await kit.memo('k', make)).toBe(1);
    expect(await kit.memo('k', make)).toBe(1);
    kit.recordVersion('b', '2');
    kit.recordVersion('a', '1');
    expect(Object.keys(kit.versions())).toEqual(['a', 'b']);
  });
});

describe('work copy', () => {
  it('copies only the listed files, with the same relative paths', async () => {
    const repo = materializeFixture('d4-deadcode');
    const copy = await createWorkCopy(repo, ['packages/api/api/core.py', 'packages/web/src/mod.ts']);
    expect(readFileSync(path.join(copy.dir, 'packages/api/api/core.py'), 'utf8')).toBe(
      readFileSync(path.join(repo, 'packages/api/api/core.py'), 'utf8'),
    );
    expect(existsSync(path.join(copy.dir, 'packages/api/pyproject.toml'))).toBe(false);
    expect(existsSync(path.join(copy.dir, 'packages/web/package.json'))).toBe(false);
    await copy.cleanup();
    expect(existsSync(copy.dir)).toBe(false);
  });
});

describe('knip roots', () => {
  it('uses the repository root when it has a package.json', () => {
    const repo = materializeFixture('d4-deadcode', {}, { 'package.json': '{ "name": "root" }\n' });
    expect(knipRoots(repo)).toEqual(['.']);
  });

  it('uses each shallowest package.json directory otherwise', () => {
    const repo = materializeFixture('d4-deadcode', {}, { 'packages/web/nested/package.json': '{}\n', 'tools/x/package.json': '{}\n' });
    expect(knipRoots(repo)).toEqual(['packages/web', 'tools/x']);
  });
});

describe('readToml', () => {
  it('gives undefined for a missing file and for invalid TOML', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'health-toml-'));
    writeFileSync(path.join(dir, 'ok.toml'), '[project]\nname = "x"\n');
    writeFileSync(path.join(dir, 'bad.toml'), '[project\n');
    expect(readToml(path.join(dir, 'ok.toml'))).toEqual({ project: { name: 'x' } });
    expect(readToml(path.join(dir, 'bad.toml'))).toBeUndefined();
    expect(readToml(path.join(dir, 'missing.toml'))).toBeUndefined();
  });
});
