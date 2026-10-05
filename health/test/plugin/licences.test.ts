import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginRoot = path.resolve(import.meta.dirname, '../..');

describe('licences', () => {
  it('has an MIT licence with a copyright holder', () => {
    const file = path.join(pluginRoot, 'LICENSE');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text.startsWith('MIT License')).toBe(true);
    expect(text).toMatch(/Copyright \(c\) \d{4} \S/);
  });

  it('has a CC BY 4.0 licence for the methodology', () => {
    const file = path.join(pluginRoot, 'methodology/LICENSE');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('CC BY 4.0');
  });
});
