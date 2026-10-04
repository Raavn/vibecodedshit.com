import type { Measurement, MeasureContext } from '../measure/types.js';
import { ToolError } from '../scope/types.js';
import { catalog } from './catalog.js';
import type { ResolvedTool, ToolName, ToolResult } from './kit.js';

/**
 * A tool that is missing, crashed, exited unexpectedly, printed output we cannot parse or
 * hit a network failure. Preview mode: the parameter is not_measured. Full mode: invalid run.
 * Never a score of 0 in either mode.
 */
export function unavailable(ctx: Pick<MeasureContext, 'mode'>, reason: string): Measurement {
  if (ctx.mode === 'preview') return { status: 'not_measured', reason };
  throw new ToolError(reason);
}

export function notFoundReason(name: ToolName): string {
  return `${name} not found, install: ${catalog[name].install}`;
}

/** Why a finished run counts as a failure, or null when its exit code is one of `okCodes`. */
export function failureReason(tool: ResolvedTool, result: ToolResult, okCodes: number[]): string | null {
  if (result.spawnError !== undefined) return `${tool.name} could not start: ${result.spawnError}`;
  if (result.timedOut) return `${tool.name} timed out`;
  if (result.exitCode === null || !okCodes.includes(result.exitCode)) {
    const detail = result.stderr.trim().split('\n').slice(-3).join(' | ');
    return `${tool.name} exited with ${String(result.exitCode)}${detail ? `: ${detail}` : ''}`;
  }
  return null;
}
