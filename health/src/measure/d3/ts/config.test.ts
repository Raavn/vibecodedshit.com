import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { materializeFixture } from '../../../../test/helpers/fixture.js';
import { resetTrackedCache } from '../../../scope/tracked.js';
import { directoriesOf, isDirectionRule, readDeclaredConfig } from './config.js';

function read(content: string, name = '.dependency-cruiser.js') {
  resetTrackedCache();
  const repo = materializeFixture('d3-na-ts', {}, { [name]: content });
  const warnings: string[] = [];
  return { config: readDeclaredConfig(repo, name, warnings), warnings };
}

describe('directoriesOf', () => {
  it('reads literal directory patterns', () => {
    expect(directoriesOf('^src/core/')).toEqual(['src/core']);
    expect(directoriesOf('^src')).toEqual(['src']);
    expect(directoriesOf('^(src|app)/')).toEqual(['src', 'app']);
    expect(directoriesOf('(^|/)legacy/')).toEqual(['legacy']);
    expect(directoriesOf('^packages/a\\.b/')).toEqual(['packages/a.b']);
  });
  it('does not take file patterns for directories', () => {
    expect(directoriesOf('\\.(spec|test)\\.')).toBeUndefined();
    expect(directoriesOf('[.]test[.]ts$')).toBeUndefined();
    expect(directoriesOf('^.*foo')).toBeUndefined();
  });
});

describe('isDirectionRule', () => {
  it('needs both paths to name different directories', () => {
    expect(isDirectionRule({ from: { path: '^src/a/' }, to: { path: '^src/b/' } })).toBe(true);
    expect(isDirectionRule({ from: { path: '^src/a/' }, to: { path: '^src/a/' } })).toBe(false);
    expect(isDirectionRule({ from: {}, to: { path: '\\.(spec|test)\\.' } })).toBe(false);
    expect(isDirectionRule({ from: { path: '^(src)' }, to: {} })).toBe(false);
    expect(isDirectionRule({ from: { pathNot: '^src/a/' }, to: { path: '^src/b/' } })).toBe(false);
  });
});

describe('readDeclaredConfig', () => {
  it('evaluates literal rules and skips those that need an installed project, with a warning each', () => {
    const { config, warnings } = read(`
module.exports = {
  forbidden: [
    { name: 'core-not-ui', severity: 'error', from: { path: '^src/core/' }, to: { path: '^src/ui/' } },
    { name: 'no-circular', severity: 'warn', from: {}, to: { circular: true } },
    { name: 'regex', severity: 'warn', from: { path: /^src\\/a\\// }, to: { path: '^src/b/' } },
    { name: 'info-rule', severity: 'info', from: { path: '^src/x/' }, to: { path: '^src/y/' } },
    { name: 'bad-regex', severity: 'error', from: { path: '(' }, to: {} },
    { name: 'dyn', severity: 'error', from: { path: prefix + '/' }, to: {} },
  ],
  options: { doNotFollow: 'node_modules' },
};`);
    expect(config?.declared).toBe(true);
    expect(config?.forbidden.map((r) => r.name)).toEqual(['core-not-ui', 'regex']);
    expect(warnings.join('\n')).toMatch(/no-circular.*needs an installed project/);
    expect(warnings.join('\n')).toMatch(/bad-regex/);
    expect(warnings.join('\n')).toMatch(/dyn/);
    expect(warnings.join('\n')).toMatch(/"options" and "extends" are ignored/);
  });

  it('drops the whole allowed list when one of its rules is skipped', () => {
    const { config, warnings } = read(`export default { allowed: [{ from: { path: '^src/a/' }, to: { path: '^src/b/' } }, { from: {}, to: { dependencyTypes: ['core'] } }] };`, '.dependency-cruiser.mjs');
    expect(config?.allowed).toBeUndefined();
    expect(config?.declared).toBe(true);
    expect(warnings.join('\n')).toContain('whole "allowed" list is dropped');
  });

  it('keeps a complete allowed list and reads JSON', () => {
    const js = read(`module.exports = { allowed: [{ from: { path: '^src/a/' }, to: { path: '^src/b/' } }], allowedSeverity: 'error' };`);
    expect(js.config?.allowed).toHaveLength(1);
    expect(js.config?.allowedSeverity).toBe('error');
    const json = read(JSON.stringify({ forbidden: [{ name: 'x', severity: 'error', from: { path: '^a/' }, to: { path: '^b/' } }] }), '.dependency-cruiser.json');
    expect(json.config?.forbidden).toHaveLength(1);
  });

  it('treats a file it cannot read as absent', () => {
    expect(read('module.exports = require("./x");').config).toBeUndefined();
    expect(read('{ not json', '.dependency-cruiser.json').config).toBeUndefined();
  });

  it('does not run the file', () => {
    const { warnings } = read(`require('node:fs').writeFileSync('/tmp/health-must-not-exist', 'x');\nmodule.exports = { forbidden: [] };`);
    expect(warnings).toEqual([]);
    expect(existsSync('/tmp/health-must-not-exist')).toBe(false);
  });
});
