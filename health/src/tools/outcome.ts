import type { Measurement } from '../measure/types.js';
import type { ResolvedTool, ToolResult } from './kit.js';

/**
 * A tool that is missing, crashed, exited unexpectedly, printed output we cannot parse or
 * hit a network failure: the parameter is not_measured with the reason, in both modes, and the
 * rest of the run still scores. A full run with any not_measured parameter is not comparable
 * (`scan.ts`). Never a score of 0.
 */
export function unavailable(reason: string): Measurement {
  return { status: 'not_measured', reason };
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
