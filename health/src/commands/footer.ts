import path from 'node:path';
import type { RunFile } from '../run/schema.js';

const PRIVACY =
  "Your code stayed on this machine. The scan only looked up your dependencies' names and versions on the public npm and PyPI registries (and OSV, if osv-scanner is installed).";

/** The Docker command a user of an npx install runs to get the full-run image, with the package root resolved. */
export function imageBuildCommand(packageRoot: string, tag: string): string {
  const docker = path.join(packageRoot, 'docker');
  return `docker build -t ${tag} -f ${path.join(docker, 'Dockerfile')} ${docker}`;
}

/** Lines printed after the scan summary: what a preview skipped, that nothing was uploaded, and how to submit. */
export function footer(run: RunFile, outFile: string, interactive = false): string {
  const lines: string[] = [];
  if (run.mode === 'preview') {
    const skipped = run.parameters.filter((p) => p.status === 'not_measured' && p.reason?.startsWith('execution layer')).map((p) => p.id);
    if (skipped.length > 0) lines.push(`Skipped (needs Docker): ${skipped.join(', ')}. Run a full scan with Docker to measure them.`);
  }
  lines.push(PRIVACY);
  // An interactive scan asks about the leaderboard next instead of printing the command.
  if (interactive) return `${lines.join('\n')}\n`;
  if (run.valid && run.comparable && run.mode === 'full') {
    lines.push(`To compare your result on app.vibecodedshit.com, run: npx vibecodedshit submit ${outFile} --email <you@example.com>`);
    lines.push('It prints the payload first and sends nothing unless you add --confirm.');
  } else {
    lines.push('Only full, comparable runs (Docker needed) can be submitted. Nothing is submitted unless you run the submit command yourself.');
  }
  return `${lines.join('\n')}\n`;
}
