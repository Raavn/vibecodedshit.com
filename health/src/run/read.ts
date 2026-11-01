import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { RunFile } from './schema.js';

export class RunReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunReadError';
  }
}

const nullableScore = z.number().nullable();

/** The fields `report` and `diff` read. Unknown fields pass through untouched. */
const runFileSchema = z.looseObject({
  schemaVersion: z.literal(1),
  valid: z.boolean(),
  invalidReason: z.string().optional(),
  warnings: z.array(z.string()),
  methodology: z.looseObject({ version: z.string() }),
  mode: z.enum(['preview', 'full']),
  comparable: z.boolean(),
  comparableReason: z.string().optional(),
  asOf: z.string(),
  layers: z.array(z.enum(['static', 'execution'])),
  repo: z.looseObject({ path: z.string(), headCommit: z.string().nullable(), treeHash: z.string().nullable() }),
  tools: z.record(z.string(), z.unknown()),
  execution: z
    .looseObject({
      feedbackLoop: z.looseObject({ typecheckSeconds: z.number(), lintSeconds: z.number(), testSeconds: z.number(), totalSeconds: z.number() }),
    })
    .optional(),
  reportOnly: z.record(z.string(), z.unknown()).optional(),
  ignoreSet: z.looseObject({
    healthignoreSha256: z.string().nullable(),
    gitleaksignoreSha256: z.string().nullable(),
    excludedLinesPercent: z.number(),
  }),
  scope: z.looseObject({ logicFiles: z.number(), logicLines: z.number(), sourceLines: z.number(), packages: z.array(z.string()) }),
  parameters: z.array(
    z.looseObject({
      id: z.string(),
      status: z.enum(['measured', 'not_applicable', 'not_measured', 'failed']),
      reason: z.string().optional(),
      weight: z.number(),
      raw: z.looseObject({ kind: z.enum(['ratio', 'level', 'number', 'components']) }).nullable().optional(),
      score: z.number().optional(),
      units: z.array(z.looseObject({ package: z.string(), group: z.string(), weight: z.number(), raw: z.looseObject({}), score: z.number() })).optional(),
    }),
  ),
  dimensions: z.array(z.looseObject({ id: z.number(), key: z.string(), score: nullableScore })),
  breakdown: z.looseObject({
    byPackage: z.record(z.string(), z.record(z.string(), nullableScore)),
    byGroup: z.record(z.string(), z.record(z.string(), nullableScore)),
  }),
  health: z.looseObject({ score: z.number(), displayed: z.number(), band: z.string() }).nullable(),
});

/** Parse a run.json document. Throws RunReadError naming the file for anything but a valid version 1 run. */
export function parseRun(text: string, file: string): RunFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new RunReadError(`${file}: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (typeof doc === 'object' && doc !== null && 'schemaVersion' in doc && doc.schemaVersion !== 1) {
    throw new RunReadError(`${file}: unsupported schemaVersion ${JSON.stringify(doc.schemaVersion)} (this CLI reads 1)`);
  }
  const result = runFileSchema.safeParse(doc);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)';
    throw new RunReadError(`${file}: not a run.json: ${where}: ${issue?.message ?? 'invalid'}`);
  }
  return result.data as unknown as RunFile;
}

export function readRun(file: string): RunFile {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new RunReadError(`${file}: cannot read (${err instanceof Error ? err.message : String(err)})`);
  }
  return parseRun(text, file);
}
