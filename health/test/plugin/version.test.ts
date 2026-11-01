import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURRENT_METHODOLOGY_VERSION } from '../../src/methodology/load.js';

const pluginRoot = path.resolve(import.meta.dirname, '../..');
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { version?: string; plugin?: string; methodology?: string };
const published = readJson(path.join(pluginRoot, '../version.json'));

describe('version.json', () => {
  it('equals the plugin version', () => {
    expect(published.plugin).toBe(readJson(path.join(pluginRoot, '.claude-plugin/plugin.json')).version);
  });

  it('equals the current methodology version', () => {
    expect(published.methodology).toBe(CURRENT_METHODOLOGY_VERSION);
  });
});
