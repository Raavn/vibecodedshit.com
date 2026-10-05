import { logicGlobs, pythonTargets } from '../test-runners/detect.js';
import { RUNNERS } from '../test-runners/index.js';
/**
 * One run of the invocation's test runner with the report and coverage flags of the methodology, so the
 * results and the coverage come from a single instrumented run (1.1 to 1.3, and 6.3's test time).
 * The reports are read from /out, never stdout; the exit code is not the pass/fail source. Network off.
 */
export const test = {
    name: 'test',
    network: false,
    command(ctx) {
        const invocation = ctx.invocation;
        if (!invocation)
            return null;
        return { argv: RUNNERS[invocation.runner].argv(invocation, logicGlobs(ctx.files, ctx.dir), pythonTargets(ctx.files, ctx.dir)) };
    },
};
