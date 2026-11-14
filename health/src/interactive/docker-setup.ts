import { imageBuildCommand } from '../commands/footer.js';
import type { CliIo } from '../commands/common.js';
import { ToolError } from '../scope/types.js';
import type { Prompter } from './prompt.js';
import type { System } from './system.js';

export type DockerSetup = { digest: string } | { previewReason: string };

export interface DockerSetupContext {
  io: CliIo;
  prompt: Prompter;
  system: System;
  packageRoot: string;
  imageDigest: (tag: string) => Promise<string>;
}

const DOWNLOAD_URL = 'https://www.docker.com/products/docker-desktop/';
const START_TIMEOUT_MS = 180_000;
const POLL_MS = 3_000;

const ok = (code: number | null): boolean => code === 0;

async function install(ctx: DockerSetupContext): Promise<boolean> {
  const { system, io } = ctx;
  if (system.platform === 'darwin') {
    if (!ok(await system.exec('brew', ['--version']))) {
      io.stderr(`Homebrew is not installed, so Docker cannot be installed for you. Download Docker Desktop from ${DOWNLOAD_URL}\n`);
      return false;
    }
    return ok(await system.exec('brew', ['install', '--cask', 'docker-desktop'], { inherit: true }));
  }
  if (system.platform === 'linux') {
    return ok(await system.exec('sh', ['-c', 'curl -fsSL https://get.docker.com | sudo sh'], { inherit: true }));
  }
  if (system.platform === 'win32') {
    const args = ['install', '-e', '--id', 'Docker.DockerDesktop', '--accept-package-agreements', '--accept-source-agreements'];
    return ok(await system.exec('winget', args, { inherit: true }));
  }
  io.stderr(`Docker cannot be installed for you on ${system.platform}. Download it from ${DOWNLOAD_URL}\n`);
  return false;
}

async function start(ctx: DockerSetupContext): Promise<boolean> {
  const { system, io } = ctx;
  if (system.platform === 'darwin') {
    await system.exec('open', ['-a', 'Docker']);
    io.stdout('Starting Docker Desktop. If it asks you to accept its terms, do that in its window.\n');
  } else if (system.platform === 'linux') {
    await system.exec('sudo', ['systemctl', 'start', 'docker'], { inherit: true });
  } else if (system.platform === 'win32') {
    await system.exec('cmd', ['/c', 'start', '', 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe']);
    io.stdout('Starting Docker Desktop. If it asks you to accept its terms, do that in its window.\n');
  }
  io.stdout('Waiting for Docker to start (up to 3 minutes)...\n');
  for (let waited = 0; waited < START_TIMEOUT_MS; waited += POLL_MS) {
    if (ok(await system.exec('docker', ['info']))) return true;
    await system.sleep(POLL_MS);
  }
  return false;
}

function notStarted(platform: NodeJS.Platform): string {
  const linux = platform === 'linux' ? ' If Docker runs but needs sudo, run `sudo usermod -aG docker $USER`, log in again and rerun the scan.' : '';
  return `Docker did not start within 3 minutes.${linux}`;
}

/**
 * Get Docker and the scan image ready for a full run, asking before each install, start or build.
 * Any No, or a step that fails, returns the reason to fall back to a preview scan.
 */
export async function setUpDocker(tag: string, ctx: DockerSetupContext): Promise<DockerSetup> {
  const { system, prompt, io } = ctx;

  if (!ok(await system.exec('docker', ['--version']))) {
    if (!(await prompt.confirm('Docker is not installed. A full scan needs it. Install and start Docker now?'))) {
      return { previewReason: 'Docker is not installed.' };
    }
    if (!(await install(ctx))) return { previewReason: 'Docker could not be installed.' };
    if (!(await start(ctx))) return { previewReason: notStarted(system.platform) };
  } else if (!ok(await system.exec('docker', ['info']))) {
    if (!(await prompt.confirm('Docker is installed but not running. Start it now?'))) {
      return { previewReason: 'Docker is not running.' };
    }
    if (!(await start(ctx))) return { previewReason: notStarted(system.platform) };
  }

  try {
    return { digest: await ctx.imageDigest(tag) };
  } catch (err) {
    if (!(err instanceof ToolError)) throw err;
    const state = err.message.includes('out of date') ? 'is out of date' : 'is not built yet';
    if (!(await prompt.confirm(`The scan image ${tag} ${state}. Build it now? The first build takes about 5 to 10 minutes.`))) {
      return { previewReason: `The scan image ${tag} ${state}.` };
    }
  }

  const build = imageBuildCommand(ctx.packageRoot, tag).split(' ');
  if (!ok(await system.exec(build[0] ?? 'docker', build.slice(1), { inherit: true }))) {
    return { previewReason: `Building the scan image failed. Retry with: ${build.join(' ')}` };
  }
  try {
    io.stdout(`Built ${tag}.\n`);
    return { digest: await ctx.imageDigest(tag) };
  } catch (err) {
    if (!(err instanceof ToolError)) throw err;
    return { previewReason: err.message };
  }
}
