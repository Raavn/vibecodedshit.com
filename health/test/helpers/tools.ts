import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createToolKit, type ResolvedTool, type ToolKit, type ToolName, type ToolResult } from '../../src/tools/kit.js';

export type FakeTool = (args: string[], cwd: string, env?: Record<string, string>) => ToolResult | Promise<ToolResult>;

export interface FakeKit extends ToolKit {
  /** Every tool name `resolve` was asked for, in order. */
  resolved: ToolName[];
}

/** The interpreter named by the shebang of the fake `lint-imports` script: a run with this command goes to the fake. */
export const FAKE_INTERPRETER = '/fake/health-python';

function fakeLintImports(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'health-fake-il-'));
  const file = path.join(dir, 'lint-imports');
  writeFileSync(file, `#!${FAKE_INTERPRETER}\n`);
  chmodSync(file, 0o755);
  return file;
}

export const ok = (stdout = '', exitCode = 0): ToolResult => ({ exitCode, stdout, stderr: '', timedOut: false });

/**
 * A tool kit for tests. A function fakes that tool, `null` makes it missing. A tool that is not
 * listed is real if it is an npm tool (jscpd, knip) and missing if it is a PATH tool.
 */
export function fakeToolKit(
  fakes: Partial<Record<ToolName, FakeTool | null>> = {},
  opts: { versions?: Partial<Record<ToolName, string>>; fetch?: typeof fetch } = {},
): FakeKit {
  const real = createToolKit();
  const resolved: ToolName[] = [];
  return {
    resolved,
    async resolve(name) {
      resolved.push(name);
      const fake = fakes[name];
      if (fake === null) return undefined;
      if (fake) {
        const version = opts.versions?.[name] ?? '0.0.0-fake';
        real.recordVersion(name, version);
        const command = name === 'import-linter' ? fakeLintImports() : `fake:${name}`;
        return { name, command, prefixArgs: [], version } satisfies ResolvedTool;
      }
      return name === 'jscpd' || name === 'knip' ? real.resolve(name) : undefined;
    },
    async run(tool, args, runOpts) {
      if (tool.command.startsWith('fake:') || tool.command === FAKE_INTERPRETER) {
        const fake = fakes[tool.name];
        if (!fake) throw new Error(`no fake for ${tool.name}`);
        return fake(args, runOpts.cwd, runOpts.env);
      }
      return real.run(tool, args, runOpts);
    },
    fetch: opts.fetch ?? real.fetch,
    recordVersion: (name, version) => real.recordVersion(name, version),
    versions: () => real.versions(),
    memo: (key, make) => real.memo(key, make),
    notFoundReason: (name) => real.notFoundReason(name),
  };
}
