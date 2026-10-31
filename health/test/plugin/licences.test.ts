import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginRoot = path.resolve(import.meta.dirname, '../..');

describe('licences', () => {
  it('has an Elastic License 2.0 licence with a copyright holder', () => {
    const file = path.join(pluginRoot, 'LICENSE');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('Elastic License 2.0');
    expect(text).toMatch(/^Copyright \d{4} \S/);
  });

  it('ships an OFL licence beside each bundled font', () => {
    for (const font of ['SpaceGrotesk', 'NotoEmoji']) {
      const file = path.join(pluginRoot, `assets/fonts/${font}-OFL.txt`);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('SIL Open Font License, Version 1.1');
    }
  });

  it('has a CC BY 4.0 licence for the methodology', () => {
    const file = path.join(pluginRoot, 'methodology/LICENSE');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('Attribution 4.0 International');
  });
});
