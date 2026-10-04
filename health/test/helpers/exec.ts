import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ExecRunner, StepOutcome, StepSpec } from '../../src/exec/types.js';

export interface FakeStep {
  exitCode: number;
  /** Report files written to the step's /out directory. */
  files?: Record<string, string>;
  timeout?: boolean;
}

/** An ExecRunner for tests: `respond` decides each step's exit code and reports, and every spec is recorded. */
export function fakeRunner(respond: (spec: StepSpec) => FakeStep): ExecRunner & { specs: StepSpec[] } {
  const specs: StepSpec[] = [];
  return {
    specs,
    async runStep(spec) {
      specs.push(spec);
      const result = respond(spec);
      for (const [name, text] of Object.entries(result.files ?? {})) {
        mkdirSync(spec.outDir, { recursive: true });
        writeFileSync(path.join(spec.outDir, name), text);
      }
      const outcome: StepOutcome = {
        status: result.timeout ? 'timeout' : result.exitCode === 0 ? 'ok' : 'failed',
        exitCode: result.timeout ? null : result.exitCode,
        durationMs: 1,
        outputDir: spec.outDir,
      };
      return outcome;
    },
  };
}

export const FAKE_DIGEST = 'sha256:' + 'ab'.repeat(32);
