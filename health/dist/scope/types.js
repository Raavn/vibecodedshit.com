/** A failure of the tool itself (missing interpreter, crashed helper), not of the scanned repository. */
export class ToolError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolError';
    }
}
