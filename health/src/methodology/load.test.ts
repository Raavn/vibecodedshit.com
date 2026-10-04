import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMethodology, MethodologyError, packageRoot } from './load.js';

function copyMethodology(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'health-method-'));
  cpSync(path.join(packageRoot, 'methodology'), path.join(root, 'methodology'), { recursive: true });
  return root;
}

describe('loadMethodology', () => {
  it('loads v1.0 with six dimensions and the 4.2 definition', () => {
    const m = loadMethodology('1.0');
    expect(m.dimensions.map((d) => d.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(m.capMargin).toBe(30);
    expect(m.dimensions[3]?.parameters.find((p) => p.id === '4.2')?.weight).toBe(20);
  });

  it('rejects an unknown version', () => {
    expect(() => loadMethodology('9.9')).toThrow(MethodologyError);
    expect(() => loadMethodology('../x')).toThrow(/Unknown methodology version/);
  });

  it('rejects malformed YAML and names the file', () => {
    const root = copyMethodology();
    writeFileSync(path.join(root, 'methodology', 'v1.0', 'scope.yaml'), 'a: [unclosed\n');
    expect(() => loadMethodology('1.0', root)).toThrow(/scope\.yaml/);
  });

  it('rejects a schema failure and names the path inside the file', () => {
    const root = copyMethodology();
    const file = path.join(root, 'methodology', 'v1.0', 'dimensions', '4-complexity-maintainability.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('weight: 20', 'weight: nope'));
    expect(() => loadMethodology('1.0', root)).toThrow(/4-complexity-maintainability\.yaml: parameters\.1\.weight/);
  });

  it('rejects weights that do not sum to 100', () => {
    const root = copyMethodology();
    const file = path.join(root, 'methodology', 'v1.0', 'dimensions', '4-complexity-maintainability.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('weight: 20', 'weight: 21'));
    expect(() => loadMethodology('1.0', root)).toThrow(/sum to 101/);
  });

  it('rejects a version that does not match its directory', () => {
    const root = copyMethodology();
    const file = path.join(root, 'methodology', 'v1.0', 'methodology.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('version: "1.0"', 'version: "1.1"'));
    expect(() => loadMethodology('1.0', root)).toThrow(/does not match directory/);
  });

  it('parses the 3.5 forbidden-import lists and infrastructure directories from the YAML text', () => {
    const m = loadMethodology('1.0');
    expect(m.d3.forbiddenImports.typescript_javascript).toEqual([
      'next', 'react', 'react-dom', 'express', '@prisma/client', 'drizzle-orm', 'pg', 'mysql2', 'mongoose', 'redis', 'ioredis', 'axios',
      'node-fetch', 'fs', 'http', 'https',
    ]);
    expect(m.d3.forbiddenImports.python).toEqual([
      'django', 'fastapi', 'flask', 'starlette', 'sqlalchemy', 'requests', 'httpx', 'aiohttp', 'boto3', 'psycopg', 'psycopg2', 'redis', 'pymongo',
    ]);
    expect(m.d3.forbiddenImports.python).not.toContain('A call to the builtin open also counts');
    expect(m.d3.infrastructureDirectories).toEqual(['infrastructure', 'infra', 'db', 'adapters']);
  });

  it('rejects a 3.5 measure text without a forbidden-import list', () => {
    const root = copyMethodology();
    const file = path.join(root, 'methodology', 'v1.0', 'dimensions', '3-architecture-boundaries.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Forbidden imports: next', 'Banned: next'));
    expect(() => loadMethodology('1.0', root)).toThrow(/no "Forbidden imports:" list/);
  });
});
