import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CURRENT_METHODOLOGY_VERSION, loadMethodology } from '../../health/src/methodology/load.js';
import { runScan } from '../../health/src/run/scan.js';
import type { RunFile } from '../../health/src/run/schema.js';
import { createImageToolKit } from '../../health/src/tools/image.js';

const execFileAsync = promisify(execFile);

/**
 * Package cache for the install steps of a full run, kept apart from the one the user's own scans share
 * (`~/.cache/health/packages`), so a stranger's install scripts never write into it. `HEALTH_PACKAGE_CACHE` still wins.
 */
export function outboundPackageCache(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const setting = env.HEALTH_PACKAGE_CACHE?.trim();
  if (setting) return setting;
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'health', 'outbound-packages');
}

/**
 * Full-history clone into a temp directory, so the 5.4 history scan and hotspots see every commit. A clone runs no
 * repository code: hooks are pointed at nothing, LFS smudge is skipped, submodules are not fetched and no prompt can block.
 */
async function clone(fullName: string, dir: string): Promise<void> {
  await execFileAsync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'clone', '--no-tags', '--quiet', `https://github.com/${fullName}.git`, dir],
    { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' }, timeout: 600_000 },
  );
}

export interface ScanResult {
  preview: RunFile;
  /** Only when `gate(preview)` passed. */
  full?: RunFile;
}

/**
 * Two passes on one clone. First the static layer (`mode: 'preview'`, image tool kit, so gitleaks, osv-scanner, knip
 * and the Python tools run in the `health:1.0` container, never on the host). Only when `gate` passes on that preview
 * does the full run follow: install, build, typecheck, lint, knip and tests, each step in the container on a temp work
 * copy (`runScan` with `mode: 'full'`). No code from the repository runs on the host in either pass. Never submitted.
 */
export async function scanRepo(fullName: string, asOf: string, gate: (preview: RunFile) => boolean): Promise<ScanResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'outbound-'));
  const repoPath = path.join(dir, 'repo');
  try {
    await clone(fullName, repoPath);
    const methodology = loadMethodology(CURRENT_METHODOLOGY_VERSION);
    const base = { repoPath, methodologyVersion: CURRENT_METHODOLOGY_VERSION, asOf };
    const preview = await runScan(
      { ...base, mode: 'preview', tools: createImageToolKit({ runner: methodology.execution.runner, repoPath }) },
      methodology,
    );
    if (!gate(preview)) return { preview };
    const full = await runScan({ ...base, mode: 'full' }, methodology);
    return { preview, full };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
