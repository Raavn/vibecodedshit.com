import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const pluginRoot = path.resolve(import.meta.dirname, '../..');
const skill = readFileSync(path.join(pluginRoot, 'skills/codebase-health/SKILL.md'), 'utf8');
const methodology = parse(readFileSync(path.join(pluginRoot, 'methodology/v1.0/methodology.yaml'), 'utf8')) as { version: string };

describe('SKILL.md', () => {
  it('forbids Claude from computing scores', () => {
    expect(skill).toContain('You never measure, compute, estimate, round or adjust a score. Every number you state is copied from run.json or the methodology YAML.');
  });

  it('makes submission opt-in, shows the payload first and defaults to No', () => {
    expect(skill).not.toContain('Never submit results anywhere. This version has no submission.');
    expect(skill).toContain('Show the full payload before asking.');
    expect(skill).toContain('Default answer: No.');
    expect(skill).toContain('Never pass --confirm before the user has answered yes in this conversation.');
    expect(skill).toContain('Never submit from an unattended run.');
    expect(skill).toContain('Include the repository name and the email only if the user opts in to each separately.');
    expect(skill).toContain('https://app.vibecodedshit.com/privacy');
  });

  it('asks about submission before the help line, which stays last', () => {
    expect(skill.indexOf('### 6. Submission')).toBeGreaterThan(skill.indexOf('### 5. Update check'));
    expect(skill.indexOf('### 7. Help line')).toBeGreaterThan(skill.indexOf('### 6. Submission'));
  });

  it('labels preview results not comparable', () => {
    expect(skill).toContain('A preview result is not comparable; say so.');
  });

  it('limits the help line to the vibe_coded and fragile bands', () => {
    expect(skill).toContain('Show the help line only when health.band is vibe_coded or fragile.');
    expect(skill).toContain('https://vibecodedshit.com');
  });

  it('is started only by the user and takes a path', () => {
    expect(skill).toContain('disable-model-invocation: true');
    expect(skill).toContain('argument-hint: "[path]"');
  });

  it('checks for the image tag of the bundled methodology', () => {
    expect(skill).toContain(`health:${methodology.version}`);
  });

  it('uses the update endpoint and the image build script', () => {
    expect(skill).toContain('https://app.vibecodedshit.com/api/version');
    const pkg = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['image:build']).toBeDefined();
    expect(skill).toContain('run image:build');
  });
});
