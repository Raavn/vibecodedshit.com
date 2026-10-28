import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_REVISION, IMAGE_REVISION_LABEL, imageDigest, type Spawn } from '../src/exec/docker.js';
import { p54 } from '../src/measure/p5-4.js';
import { loadMethodology } from '../src/methodology/load.js';
import { runScan } from '../src/run/scan.js';
import { ToolError } from '../src/scope/types.js';
import { createImageToolKit, mountsFor } from '../src/tools/image.js';
import { fakeRunner, FAKE_DIGEST } from './helpers/exec.js';
import { materializeFixture } from './helpers/fixture.js';

const methodology = loadMethodology('1.0');
const runner = methodology.execution.runner;

interface Reply {
  code: number | null;
  stdout?: string;
  stderr?: string;
}

/** A docker stand-in: `reply` answers each `docker` argv; every call is recorded. */
function fakeDocker(reply: (args: string[]) => Reply) {
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    const answer = reply(args);
    queueMicrotask(() => {
      if (answer.stdout) child.stdout.emit('data', Buffer.from(answer.stdout));
      if (answer.stderr) child.stderr.emit('data', Buffer.from(answer.stderr));
      child.emit('close', answer.code);
    });
    return child;
  }) as unknown as Spawn;
  return { spawn, calls };
}

/** The argv after the image tag: the command the container runs. */
const command = (args: string[]): string[] => args.slice(args.indexOf(runner.image) + 1);
const flagValues = (args: string[], flag: string): string[] => args.flatMap((a, i) => (a === flag ? [args[i + 1] ?? ''] : []));

describe('image tool kit', () => {
  it('resolves a tool by asking the image for its version and records it', async () => {
    const { spawn, calls } = fakeDocker(() => ({ code: 0, stdout: 'vulture 2.16\n' }));
    const kit = createImageToolKit({ runner, repoPath: '/repo', spawn, user: { uid: 501, gid: 20 } });
    const vulture = await kit.resolve('vulture');
    expect(vulture).toEqual({ name: 'vulture', command: 'vulture', prefixArgs: [], version: '2.16' });
    expect(kit.versions()).toEqual({ vulture: '2.16' });
    await kit.resolve('vulture');
    expect(calls).toHaveLength(1);
    const { cmd, args } = calls[0]!;
    expect(cmd).toBe('docker');
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--pull', 'never']);
    expect(command(args)).toEqual(['vulture', '--version']);
    expect(flagValues(args, '-v')).toEqual([]);
    expect(flagValues(args, '--network')).toEqual(['none']);
  });

  it('calls npm tools by their package name and gives import-linter the interpreter of its tool environment', async () => {
    const { spawn, calls } = fakeDocker((args) => ({ code: 0, stdout: command(args)[0] === 'lint-imports' ? 'lint-imports, import-linter 2.15\n' : '5.4.0\n' }));
    const kit = createImageToolKit({ runner, repoPath: '/repo', spawn, user: null });
    expect(await kit.resolve('jscpd')).toMatchObject({ command: 'jscpd', version: '5.4.0' });
    expect(command(calls[0]!.args)).toEqual(['jscpd', '--version']);
    expect(await kit.resolve('import-linter')).toMatchObject({ interpreter: '/opt/uv-tools/import-linter/bin/python' });
    expect(calls[0]!.args).not.toContain('--user');
  });

  it('is not found when the image lacks the tool (exit 127) and names the rebuild', async () => {
    const { spawn } = fakeDocker(() => ({ code: 127, stderr: 'exec: "deptry": executable file not found in $PATH' }));
    const kit = createImageToolKit({ runner, repoPath: '/repo', spawn });
    expect(await kit.resolve('deptry')).toBeUndefined();
    expect(kit.versions()).toEqual({});
    expect(kit.notFoundReason('deptry')).toBe(`deptry is not in the image ${runner.image}, rebuild it: npm run image:build`);
  });

  it('runs a tool in the container as the host user, in the same working directory, bounded like a step', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'health-imgkit-'));
    const out = mkdtempSync(path.join(tmpdir(), 'health-imgkit-out-'));
    const { spawn, calls } = fakeDocker(() => ({ code: 0, stdout: '[]' }));
    const kit = createImageToolKit({ runner, repoPath: repo, spawn, user: { uid: 501, gid: 20 } });
    const tool = { name: 'gitleaks' as const, command: 'gitleaks', prefixArgs: [], version: '8.30.1' };
    const result = await kit.run(tool, ['dir', '.', '--report-path', path.join(out, 'tree.json')], { cwd: repo, env: { A: 'b' } });
    expect(result).toEqual({ exitCode: 0, stdout: '[]', stderr: '', timedOut: false });
    const { args } = calls[0]!;
    expect(command(args)).toEqual(['gitleaks', 'dir', '.', '--report-path', path.join(out, 'tree.json')]);
    expect(flagValues(args, '--user')).toEqual(['501:20']);
    expect(flagValues(args, '-w')).toEqual([repo]);
    expect(flagValues(args, '-v').sort()).toEqual([`${out}:${out}`, `${repo}:${repo}:ro`].sort());
    expect(flagValues(args, '--network')).toEqual(['none']);
    expect(flagValues(args, '--cpus')).toEqual([String(runner.cpus)]);
    expect(flagValues(args, '--memory')).toEqual([`${runner.memory_gb}g`]);
    expect(flagValues(args, '-e')).toEqual(expect.arrayContaining(['HOME=/tmp', 'A=b', 'GIT_CONFIG_KEY_0=safe.directory']));
  });

  it('leaves the network on for osv-scanner only', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'health-imgkit-'));
    const { spawn, calls } = fakeDocker(() => ({ code: 0 }));
    const kit = createImageToolKit({ runner, repoPath: repo, spawn });
    await kit.run({ name: 'osv-scanner', command: 'osv-scanner', prefixArgs: [], version: '2.7.0' }, ['--format', 'json'], { cwd: repo });
    expect(calls[0]!.args).not.toContain('--network');
  });

  it('reports docker failures as a spawn error, never as the tool exit', async () => {
    const { spawn } = fakeDocker(() => ({ code: 125, stderr: 'docker: Error response from daemon: No such image: health:1.0.' }));
    const kit = createImageToolKit({ runner, repoPath: '/repo', spawn });
    const result = await kit.run({ name: 'vulture', command: 'vulture', prefixArgs: [], version: '2.16' }, [], { cwd: tmpdir() });
    expect(result.spawnError).toMatch(/^could not run in the image health:1\.0 \(exit 125\): docker: Error response/);
  });
});

describe('mountsFor', () => {
  it('mounts the working directory and absolute arguments at the same path, outermost only, read-only inside the repo', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'health-mounts-'));
    const repo = path.join(root, 'repo');
    const scratch = path.join(root, 'scratch');
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    mkdirSync(scratch);
    writeFileSync(path.join(repo, 'requirements.txt'), '');
    const mounts = mountsFor(
      [path.join(repo, 'src'), `requirements.txt:${path.join(repo, 'requirements.txt')}`, path.join(scratch, 'report.json'), 'relative', '/does/not/exist/x'],
      repo,
      repo,
    );
    expect(mounts).toEqual([
      { dir: repo, readOnly: true },
      { dir: scratch, readOnly: false },
    ]);
  });
});

describe('image revision', () => {
  it('matches the label in the Dockerfile', () => {
    const dockerfile = readFileSync(path.resolve(import.meta.dirname, '..', 'docker', 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain(`LABEL ${IMAGE_REVISION_LABEL}="${IMAGE_REVISION}"`);
  });

  it('accepts the current revision and rejects an image built before it', async () => {
    const current = fakeDocker(() => ({ code: 0, stdout: `sha256:abc ${IMAGE_REVISION}\n` }));
    await expect(imageDigest('health:1.0', current.spawn)).resolves.toBe('sha256:abc');
    const old = fakeDocker(() => ({ code: 0, stdout: 'sha256:abc <no value>\n' }));
    await expect(imageDigest('health:1.0', old.spawn)).rejects.toThrow(ToolError);
    await expect(imageDigest('health:1.0', old.spawn)).rejects.toThrow(/out of date .*npm run image:build/);
  });
});

describe('full scan tools', () => {
  it('run in the image, and the run records the versions the image reports', async () => {
    const repo = materializeFixture('d5-secret');
    const { spawn, calls } = fakeDocker((args) => {
      const argv = command(args);
      if (argv[1] === 'version') return { code: 0, stdout: 'v8.30.1\n' };
      const report = argv[argv.indexOf('--report-path') + 1];
      if (report) writeFileSync(report, '[]');
      return { code: 0 };
    });
    const run = await runScan({
      repoPath: repo,
      methodologyVersion: '1.0',
      mode: 'full',
      asOf: '2026-10-04',
      execRunner: fakeRunner(() => ({ exitCode: 0 })),
      imageDigest: FAKE_DIGEST,
      dockerSpawn: spawn,
      measurers: [p54],
    });
    expect(run.valid).toBe(true);
    expect(run.parameters.find((p) => p.id === '5.4')?.status).toBe('measured');
    expect(run.tools.static?.gitleaks).toBe('8.30.1');
    const gitleaksRuns = calls.filter((c) => command(c.args)[0] === 'gitleaks');
    expect(gitleaksRuns.map((c) => command(c.args)[1])).toEqual(['version', 'dir', 'git']);
    expect(calls.every((c) => c.cmd === 'docker')).toBe(true);
  });
});
