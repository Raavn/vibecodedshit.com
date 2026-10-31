import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { IMAGE_REVISION_LABEL } from '../../src/exec/docker.js';

const pluginRoot = path.resolve(import.meta.dirname, '../..');
const skill = readFileSync(path.join(pluginRoot, 'skills/codebase-health/SKILL.md'), 'utf8');
const methodology = parse(readFileSync(path.join(pluginRoot, 'methodology/v1.0/methodology.yaml'), 'utf8')) as { version: string };

describe('SKILL.md', () => {
  it('forbids Claude from computing scores and from submitting results', () => {
    expect(skill).toContain('You never measure, compute, estimate, round or adjust a score. Every number you state is copied from run.json, the methodology YAML or the health CLI\'s output.');
    expect(skill).toContain('Never submit results anywhere. This version has no submission.');
  });

  it('labels preview results not comparable', () => {
    expect(skill).toContain('A preview result is not comparable; say so.');
  });

  it('limits the help line to the vibe_coded and fragile bands', () => {
    expect(skill).toContain('Show the help line only when health.band is vibe_coded or fragile.');
    expect(skill).toContain('https://vibecodedshit.com');
  });

  it('only scans and never suggests fixing the codebase', () => {
    expect(skill).toContain('Never suggest, offer or start fixing the codebase.');
    expect(skill).not.toContain('to fix.');
  });

  it('builds a missing image in the background instead of handing the user a command', () => {
    expect(skill).toContain('Never hand them a command to run.');
    expect(skill).not.toContain('Never build the image yourself');
    expect(skill).not.toContain('Build the image only after the user said yes.');
    expect(skill).toContain('Docker is running but the image is missing');
    expect(skill).toContain('in the background, without asking first');
  });

  it('asks before anything that needs Docker installed or started', () => {
    expect(skill).toContain('Never install Docker or start its daemon yourself');
    expect(skill).toContain('Docker is not installed');
    expect(skill).toContain('Docker is installed but not running');
  });

  it('opens with the repository name', () => {
    expect(skill).toContain("I'm going to take you through the health scan of");
  });

  it('is started only by the user and takes a path', () => {
    expect(skill).toContain('disable-model-invocation: true');
    expect(skill).toContain('argument-hint: "[path]"');
  });

  it('checks for the image tag of the bundled methodology', () => {
    expect(skill).toContain(`health:${methodology.version}`);
  });

  it('treats an image built for an older revision like a missing one', () => {
    expect(skill).toContain(`index .Config.Labels "${IMAGE_REVISION_LABEL}"`);
    expect(skill).toContain(`LABEL ${IMAGE_REVISION_LABEL}`);
    expect(skill).toContain('the image is missing or out of date');
  });

  it('writes the card against the plugin run history', () => {
    expect(skill).toContain('card "<RUN_DIR>/run.json" --history "${CLAUDE_PLUGIN_DATA}/runs" --out "<RUN_DIR>/health-card.png"');
  });

  it('uses the update endpoint and the image build script', () => {
    expect(skill).toContain('https://app.vibecodedshit.com/api/version');
    const pkg = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['image:build']).toBeDefined();
    expect(skill).toContain('run image:build');
  });
});
