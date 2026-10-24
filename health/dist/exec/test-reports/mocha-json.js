/** `mocha --reporter json`: `passes`, `failures` and `pending` arrays. Null when the text is not a mocha report. */
export function parseMochaJson(text) {
    let doc;
    try {
        doc = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!doc || typeof doc.stats !== 'object' || !Array.isArray(doc.passes) || !Array.isArray(doc.failures))
        return null;
    return {
        passed: doc.passes.length,
        failed: doc.failures.length,
        errored: 0,
        skipped: Array.isArray(doc.pending) ? doc.pending.length : 0,
    };
}
