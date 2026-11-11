import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CURRENT_METHODOLOGY_VERSION, loadMethodology } from '../../health/src/methodology/load.js';
import { runScan } from '../../health/src/run/scan.js';
import type { RunFile } from '../../health/src/run/schema.js';
import { createImageToolKit } from '../../health/src/tools/image.js';

const execFileAsync = promisify(execFile);

/**
 * Shallow clone into a temp directory. A clone runs no repository code: hooks are pointed at nothing, LFS smudge is
 * skipped, submodules are not fetched and no prompt can block.
 */
async function shallowClone(fullName: string, dir: string): Promise<void> {
  await execFileAsync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'clone', '--depth', '1', '--no-tags', '--quiet', `https://github.com/${fullName}.git`, dir],
    { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' }, timeout: 300_000 },
  );
}

/**
 * The static layer only. `mode: 'preview'` skips every execution-layer parameter (no install, build, typecheck, lint or
 * tests), and `tools` is the image kit so gitleaks, osv-scanner, knip and the Python tools run in the `health:1.0`
 * container (repo mounted read-only, network off except osv-scanner) instead of on the host. Plain preview with the
 * host kit would run knip inside the repo and load its config files. The run is not comparable and is never submitted.
 *
 * A depth-1 clone gives the 5.4 history scan one commit, so a secret that exists only in history is never found here.
 */
export async function scanRepo(fullName: string, asOf: string): Promise<RunFile> {
  const dir = await mkdtemp(path.join(tmpdir(), 'outbound-'));
  const repoPath = path.join(dir, 'repo');
  try {
    await shallowClone(fullName, repoPath);
    const methodology = loadMethodology(CURRENT_METHODOLOGY_VERSION);
    return await runScan(
      {
        repoPath,
        methodologyVersion: CURRENT_METHODOLOGY_VERSION,
        mode: 'preview',
        asOf,
        tools: createImageToolKit({ runner: methodology.execution.runner, repoPath }),
      },
      methodology,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
