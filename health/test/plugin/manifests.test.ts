import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parse } from 'yaml';

const pluginRoot = path.resolve(import.meta.dirname, '../..');
const repoRoot = path.resolve(pluginRoot, '..');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

const marketplaceSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  owner: z.object({ name: z.string().min(1) }),
  plugins: z.array(z.object({ name: z.string().min(1), source: z.string().startsWith('./'), description: z.string() })).min(1),
});

const pluginSchema = z.object({
  name: z.literal('codebase-health'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  license: z.string().min(1),
});

describe('plugin manifests', () => {
  const marketplace = marketplaceSchema.parse(readJson(path.join(repoRoot, '.claude-plugin/marketplace.json')));
  const plugin = pluginSchema.parse(readJson(path.join(pluginRoot, '.claude-plugin/plugin.json')));
  const pkg = z.object({ version: z.string(), license: z.string().optional() }).passthrough().parse(readJson(path.join(pluginRoot, 'package.json')));

  it('names the marketplace and plugin the landing page uses', () => {
    expect(marketplace.name).toBe('vibecodedshit');
    expect(marketplace.plugins.map((p) => p.name)).toEqual(['codebase-health']);
  });

  it('points the marketplace entry at the plugin root', () => {
    const source = marketplace.plugins[0]?.source ?? '';
    expect(path.resolve(repoRoot, source)).toBe(pluginRoot);
  });

  it('pins a plugin version equal to package.json', () => {
    expect(plugin.version).toBe(pkg.version);
  });

  it('has no root package.json', () => {
    expect(existsSync(path.join(repoRoot, 'package.json'))).toBe(false);
  });

  it('keeps plugin dependencies installable', () => {
    expect(pkg).not.toHaveProperty('overrides');
    expect(pkg).not.toHaveProperty('workspaces');
    const deps = pkg.dependencies as Record<string, string>;
    for (const spec of Object.values(deps)) expect(spec).not.toMatch(/^(git|file|link|github|https?):/);
    const lock = z.object({ lockfileVersion: z.number() }).parse(readJson(path.join(pluginRoot, 'package-lock.json')));
    expect([2, 3]).toContain(lock.lockfileVersion);
  });

  it('has a skill with frontmatter and existing plugin paths', () => {
    const text = readFileSync(path.join(pluginRoot, 'skills/codebase-health/SKILL.md'), 'utf8');
    const front = /^---\n([\s\S]*?)\n---/.exec(text);
    expect(front).not.toBeNull();
    const meta = z.object({ name: z.literal('codebase-health'), description: z.string().min(1) }).passthrough().parse(parse(front?.[1] ?? ''));
    expect(meta.name).toBe('codebase-health');
    for (const match of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
      const rel = (match[1] ?? '').replace(/\.$/, '');
      if (rel.endsWith('/v')) continue; // methodology/v<version>/ placeholder
      expect(existsSync(path.join(pluginRoot, rel)), rel).toBe(true);
    }
  });
});
