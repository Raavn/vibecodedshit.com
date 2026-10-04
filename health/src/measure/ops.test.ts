import { describe, expect, it } from 'vitest';
import { measureFiles, methodology, unitsOf, warningsOf } from '../../test/helpers/measure.js';
import { poolParameter } from '../scoring/pool.js';
import { scoreRaw } from '../scoring/score.js';
import { parseEnvExample } from './ops/env-example.js';

const fn = (name: string): string => `export function ${name}() { return 1; }\n`;
const pyfn = (name: string): string => `def ${name}():\n    return 1\n`;
const components = (raw: unknown) => (raw as { components: Record<string, unknown> }).components;
const def65 = methodology.dimensions.flatMap((d) => d.parameters).find((p) => p.id === '6.5');

describe('parseEnvExample', () => {
  it('reads KEY=value, export, blank and comment lines, quoted values; a commented-out key does not count', () => {
    expect(parseEnvExample('# note\n\nA=1\nexport B="two words"\nC=\'x\'\n# D=4\nE = 5 # trailing\n')).toEqual({ A: '1', B: 'two words', C: 'x', E: '5' });
  });
});

describe('6.5 env-ts and env-py', () => {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ workspaces: ['ts'] }),
    'ts/package.json': '{"name":"ts"}',
    'ts/src/config.ts': [
      'export function load() {',
      '  const a = process.env.API_URL;',
      "  const b = process.env['DB_URL'];",
      '  const { SECRET, PORT: p } = process.env;',
      '  const v = import.meta.env.VITE_X;',
      '  const excluded = [process.env.NODE_ENV, process.env.CI, process.env.HOME, process.env.PATH, process.env.PWD, process.env.TZ, process.env.NEXT_RUNTIME, process.env.VERCEL_URL, process.env.NETLIFY, process.env.RENDER_X, process.env.RAILWAY_X, process.env.GITHUB_TOKEN];',
      '  const env = process.env;',
      '  const aliased = env.ALIASED;',
      "  const key = 'X';",
      '  const computed = process.env[key];',
      '  const { ...rest } = process.env;',
      '  return [a, b, SECRET, p, v, excluded, aliased, computed, rest];',
      '}',
      '',
    ].join('\n'),
    'ts/src/config.test.ts': "it('x', () => { expect(process.env.TEST_ONLY).toBe(1); });\n",
    'ts/next.config.js': 'module.exports = { x: process.env.CONFIG_ONLY };\n',
    'ts/.env.example': 'API_URL=\nexport SECRET=s\nVITE_X=1\nNODE_ENV=development\nUNUSED=1\n# DB_URL=\n',
    'py/pyproject.toml': '[project]\nname = "py"\n',
    'py/app.py': [
      'import os',
      'def f(name):',
      '    a = os.environ["DATABASE_URL"]',
      '    b = os.environ.get("REDIS_URL")',
      '    c = os.getenv("SECRET_KEY")',
      '    d = [os.environ.get("HOME"), os.getenv("PATH"), os.environ["RAILWAY_ENVIRONMENT"]]',
      '    e = os.environ.get(name)',
      '    os.environ["WRITTEN"] = "1"',
      '    return a, b, c, d, e',
      '',
    ].join('\n'),
    'py/.env.sample': 'DATABASE_URL=postgres://\nSECRET_KEY=x\n',
  };

  it('counts the reads of logic files only, minus the excluded names', async () => {
    const m = await measureFiles('6.5', files);
    const byPackage = Object.fromEntries(unitsOf(m).map((u) => [u.package, components(u.raw).env_documented]));
    // TS: API_URL DB_URL SECRET PORT VITE_X read; the example documents API_URL SECRET VITE_X (NODE_ENV is excluded, # DB_URL is a comment).
    expect(byPackage.ts).toEqual({ kind: 'ratio', numerator: 3, denominator: 5, scale: 100 });
    // Python: DATABASE_URL REDIS_URL SECRET_KEY read; HOME PATH RAILWAY_ENVIRONMENT excluded; .env.sample documents two.
    expect(byPackage.py).toEqual({ kind: 'ratio', numerator: 2, denominator: 3, scale: 100 });
  });

  it('python reads through from-import and an import alias', async () => {
    const m = await measureFiles('6.5', {
      'app.py': 'import os as o\nfrom os import environ, getenv as ge\ndef f():\n    return [o.getenv("A"), o.environ["B"], environ["C"], environ.get("D"), ge("E"), environ.setdefault("F", "1"), environ.pop("G", None)]\n',
    });
    expect(components(unitsOf(m)[0]?.raw).env_documented).toEqual({ kind: 'ratio', numerator: 0, denominator: 5, scale: 100 });
  });

  it('a unit that reads no variable has emptyScore 100 even without an example file, and scores 100 for env_documented', async () => {
    const m = await measureFiles('6.5', { 'src/a.ts': fn('a') });
    const raw = unitsOf(m)[0]?.raw as Parameters<typeof scoreRaw>[1];
    expect(components(raw).env_documented).toEqual({ kind: 'ratio', numerator: 0, denominator: 0, scale: 100, emptyScore: 100 });
    if (!def65) throw new Error('no 6.5');
    // runtime_pinned is "no" (0), env_documented 100: the mean is 50. when_empty (0) is untouched.
    expect(scoreRaw(def65, raw)).toBe(50);
    expect(def65.raw.when_empty).toBe(0);
    expect(poolParameter(def65, [{ package: '.', group: 'typescript_javascript', weight: 1, raw }]).score).toBe(50);
  });

  it('with variables read and no example file the numerator is 0', async () => {
    const m = await measureFiles('6.5', { 'src/a.ts': 'export function a() { return process.env.X; }\n' });
    expect(components(unitsOf(m)[0]?.raw).env_documented).toEqual({ kind: 'ratio', numerator: 0, denominator: 1, scale: 100 });
  });

  it('the example file is searched at the package directory, then each ancestor, in the YAML order', async () => {
    const m = await measureFiles('6.5', {
      'package.json': JSON.stringify({ workspaces: ['pkg'] }),
      'pkg/package.json': '{"name":"p"}',
      'pkg/src/a.ts': 'export function a() { return process.env.X; }\n',
      '.env.example': 'X=1\n',
      'pkg/.env.template': 'Y=1\n',
    });
    // The package's own .env.template wins over the root's .env.example.
    expect(components(unitsOf(m)[0]?.raw).env_documented).toEqual({ kind: 'ratio', numerator: 0, denominator: 1, scale: 100 });
    const root = await measureFiles('6.5', { 'src/a.ts': 'export function a() { return process.env.X; }\n', '.env.dist': 'Y=1\n', '.env.example': 'X=1\n' });
    expect(components(unitsOf(root)[0]?.raw).env_documented).toMatchObject({ numerator: 1 });
  });
});

describe('6.5 runtime pin', () => {
  const pinned = async (files: Record<string, string>, group: 'ts' | 'py'): Promise<string> => {
    const source: Record<string, string> = group === 'ts' ? { 'src/a.ts': fn('a') } : { 'a.py': pyfn('a') };
    const m = await measureFiles('6.5', { ...source, ...files });
    return (components(unitsOf(m)[0]?.raw).runtime_pinned as { level: string }).level;
  };

  it.each<[string, Record<string, string>, 'ts' | 'py', string]>([
    ['.nvmrc pins the Node group', { '.nvmrc': '22\n' }, 'ts', 'yes'],
    ['.nvmrc does not pin Python', { '.nvmrc': '22\n' }, 'py', 'no'],
    ['an empty .nvmrc does not pin', { '.nvmrc': '  \n' }, 'ts', 'no'],
    ['.node-version', { '.node-version': '22.1.0\n' }, 'ts', 'yes'],
    ['engines.node', { 'package.json': '{"engines":{"node":">=22"}}' }, 'ts', 'yes'],
    ['volta', { 'package.json': '{"volta":{"node":"22.1.0"}}' }, 'ts', 'yes'],
    ['.tool-versions with nodejs', { '.tool-versions': 'nodejs 22.1.0\n' }, 'ts', 'yes'],
    ['.tool-versions with python', { '.tool-versions': 'nodejs 22\npython 3.12\n' }, 'py', 'yes'],
    ['.tool-versions without the language', { '.tool-versions': 'ruby 3.3\n' }, 'ts', 'no'],
    ['mise.toml node', { 'mise.toml': '[tools]\nnode = "22"\n' }, 'ts', 'yes'],
    ['mise.toml python array', { 'mise.toml': '[tools]\npython = ["3.12"]\n' }, 'py', 'yes'],
    ['.python-version', { '.python-version': '3.12\n' }, 'py', 'yes'],
    ['requires-python', { 'pyproject.toml': '[project]\nname = "x"\nrequires-python = ">=3.11"\n' }, 'py', 'yes'],
    ['runtime.txt', { 'runtime.txt': 'python-3.12.1\n' }, 'py', 'yes'],
    ["Poetry's python dependency does not pin", { 'pyproject.toml': '[tool.poetry.dependencies]\npython = "^3.12"\n' }, 'py', 'no'],
    ['a malformed pyproject.toml does not pin', { 'pyproject.toml': '[project\n' }, 'py', 'no'],
  ])('%s', async (_name, files, group, expected) => {
    expect(await pinned(files, group)).toBe(expected);
  });

  it('a pin at an ancestor covers a package below it; a malformed file is reported', async () => {
    const m = await measureFiles('6.5', {
      '.nvmrc': '22\n',
      'package.json': JSON.stringify({ workspaces: ['pkg'] }),
      'pkg/package.json': '{"name":"p"}',
      'pkg/src/a.ts': fn('a'),
    });
    expect(components(unitsOf(m)[0]?.raw).runtime_pinned).toEqual({ kind: 'level', level: 'yes' });
    const bad = await measureFiles('6.5', { 'a.py': pyfn('a'), 'pyproject.toml': '[project\n' });
    expect(warningsOf(bad).join()).toContain('pyproject.toml is not valid TOML');
  });
});

describe('6.6 docs-cmds', () => {
  const base: Record<string, string> = {
    'src/a.ts': fn('a'),
    'package.json': JSON.stringify({ name: 'root', scripts: { lint: 'eslint .', types: 'tsc --noEmit', test: 'vitest run', build: 'tsc' }, dependencies: { tsx: '1' } }),
    Makefile: 'check:\n\tnpm run lint\n',
    'web/package.json': JSON.stringify({ name: 'web', scripts: { 'web-build': 'vite build' } }),
    'scripts/seed.py': 'print(1)\n',
  };
  const agents = [
    '# Agents', '',
    '```bash', 'npm run lint', 'npm run types', 'make check', '$ uv run pytest', 'cd web && pnpm install', 'npm run build \\', '  --silent', '```', '',
    'Use `npm test` to run the tests, see `src/index.ts` and `package.json`.',
    '',
  ].join('\n');
  const levelOf = async (files: Record<string, string>): Promise<{ level: string; warnings: string[] }> => {
    const m = await measureFiles('6.6', { ...base, ...files });
    return { level: (unitsOf(m)[0]?.raw as { level: string }).level, warnings: warningsOf(m) };
  };

  it('every documented command resolves: agent_file (inline spans that are not commands are ignored)', async () => {
    expect(await levelOf({ 'AGENTS.md': agents })).toEqual({ level: 'agent_file', warnings: [] });
  });

  it('one command that does not resolve drops to readme and is named with its file and line', async () => {
    const r = await levelOf({ 'AGENTS.md': `${agents}\n\`\`\`\nnpm run nope\n\`\`\`\n` });
    expect(r.level).toBe('readme');
    expect(r.warnings).toEqual(['6.6: AGENTS.md:16: `npm run nope` does not resolve']);
  });

  it('CLAUDE.md is read as well as AGENTS.md, and the file name match is case-insensitive', async () => {
    expect((await levelOf({ 'AGENTS.md': agents, 'claude.md': '```\nmake nope\n```\n' })).level).toBe('readme');
  });

  it('an agent file with no command and a README with commands is readme; neither is none', async () => {
    expect((await levelOf({ 'AGENTS.md': '# Agents\nNothing runnable here.\n', 'README.md': '```\nnpm test\n```\n' })).level).toBe('readme');
    expect((await levelOf({ 'AGENTS.md': '# Agents\n', 'README.md': 'Just prose, `src/index.ts`.\n' })).level).toBe('none');
    expect((await levelOf({})).level).toBe('none');
  });

  it('a package-level README with commands overrides the root README for its unit; one without defers to the root', async () => {
    const m = await measureFiles('6.6', {
      'package.json': JSON.stringify({ workspaces: ['a', 'b'] }),
      'a/package.json': '{"name":"a"}',
      'b/package.json': '{"name":"b"}',
      'a/src/x.ts': fn('x'),
      'b/src/y.ts': fn('y'),
      'README.md': 'Prose only.\n',
      'a/README.md': '```\nnpm test\n```\n',
      'b/README.md': 'No commands.\n',
    });
    expect(Object.fromEntries(unitsOf(m).map((u) => [u.package, (u.raw as { level: string }).level]))).toEqual({ a: 'readme', b: 'none' });
    const deferred = await measureFiles('6.6', { 'a/package.json': '{"name":"a"}', 'a/src/x.ts': fn('x'), 'README.md': '```\nnpm test\n```\n', 'a/README.md': 'none\n' });
    expect((unitsOf(deferred)[0]?.raw as { level: string }).level).toBe('readme');
  });

  it.each<[string, boolean]>([
    ['pnpm --filter web run web-build', true],
    ['pnpm --filter web run nope', false],
    ['npx tsx script.ts', true],
    ['npx nope-tool', false],
    ['python -m pytest', true],
    ['python -m venv .venv', true],
    ['python scripts/seed.py', true],
    ['python scripts/missing.py', false],
    ['make nope', false],
    ['just nope', false],
    ['tox -e nope', false],
    ['yarn eslint .', true],
    ['npm install', true],
    ['npm ci && npm run build', true],
    ['pip install -r requirements.txt', true],
    ['uvx ruff check .', true],
    ['bunx nope-tool', false],
    ['pytest -q', true],
  ])('%s resolves: %s', async (command, resolves) => {
    const r = await levelOf({ 'AGENTS.md': `\`\`\`\n${command}\n\`\`\`\n` });
    expect(r.level).toBe(resolves ? 'agent_file' : 'readme');
  });

  it('a Python dependency declared in requirements resolves a tool reference; python manage.py needs manage.py tracked', async () => {
    expect((await levelOf({ 'requirements.txt': 'httpie==3\n', 'AGENTS.md': '```\nuv run httpie\n```\n' })).level).toBe('agent_file');
    expect((await levelOf({ 'AGENTS.md': '```\npython manage.py migrate\n```\n' })).level).toBe('readme');
    expect((await levelOf({ 'manage.py': 'print(1)\n', 'AGENTS.md': '```\npython manage.py migrate\n```\n' })).level).toBe('agent_file');
  });
});
