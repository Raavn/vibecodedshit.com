import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { IMAGE_REVISION_LABEL } from '../../src/exec/docker.js';

const pluginRoot = path.resolve(import.meta.dirname, '../..');
const skill = readFileSync(path.join(pluginRoot, 'skills/codebase-health/SKILL.md'), 'utf8');
const methodology = parse(readFileSync(path.join(pluginRoot, 'methodology/v1.0/methodology.yaml'), 'utf8')) as { version: string };

describe('SKILL.md', () => {
  it('forbids Claude from computing scores', () => {
    expect(skill).toContain('You never measure, compute, estimate, round or adjust a score. Every number you state is copied from run.json, the methodology YAML or the health CLI\'s output.');
  });

  it('sends only a payload the user has seen and confirmed, defaulting to No', () => {
    expect(skill).not.toContain('Never submit results anywhere. This version has no submission.');
    expect(skill).toContain('Send nothing anywhere except a payload the user has seen and confirmed in this run.');
    expect(skill).toContain('Show the full payload before asking again.');
    expect(skill).toContain('Default answer: No.');
    expect(skill).toContain('Never pass --confirm before the user has answered yes in this conversation.');
    expect(skill).toContain('Never submit from an unattended run.');
    expect(skill).toContain('Include the repository name and the newsletter only if the user opts in to each separately.');
    expect(skill).toContain('https://app.vibecodedshit.com/privacy');
  });

  it('offers a non-noreply git email as the default and never stores it', () => {
    expect(skill).toContain('git config user.email');
    expect(skill).toContain('@users.noreply.github.com');
    expect(skill).toContain('The plugin stores nothing.');
  });

  it('puts Submit after Explain and before the update check, with the quote offer last', () => {
    expect(skill.indexOf('### 5. Submit')).toBeGreaterThan(skill.indexOf('### 4. Explain'));
    expect(skill.indexOf('### 6. Update check')).toBeGreaterThan(skill.indexOf('### 5. Submit'));
    expect(skill.indexOf('### 7. Quote offer')).toBeGreaterThan(skill.indexOf('### 6. Update check'));
  });

  it('labels preview results not comparable', () => {
    expect(skill).toContain('A preview result is not comparable; say so.');
  });

  it('limits the quote offer to vibe_coded and fragile TypeScript-only repos', () => {
    expect(skill).toContain('Make the quote offer only when health.band is vibe_coded or fragile and `reportOnly.pythonInScope` in run.json is `false`.');
    expect(skill).toContain('a missing value counts as Python');
    expect(skill).toContain("Peter's team at VCS will be happy to help you with that. Would you like a free, non-binding quote?");
    expect(skill).not.toContain('Peter Kisel');
    expect(skill).toContain('https://vibecodedshit.com');
  });

  it('posts a quote request only after the user confirmed the payload, defaulting to No', () => {
    expect(skill).toContain('https://app.vibecodedshit.com/api/quote-requests');
    expect(skill).toContain('Send this quote request? Default: No.');
    expect(skill).toContain('Any other answer: say nothing more and stop.');
    expect(skill).toContain('Never include the repository name.');
  });

  it('never fixes the codebase itself and offers only the free quote', () => {
    expect(skill).toContain('Never start fixing the codebase yourself. The only offer you make is the free quote in the last step.');
    expect(skill).toContain('Do not add next steps or recommendations.');
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
