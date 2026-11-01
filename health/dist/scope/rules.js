// The only hard-coded rule constants: the prose exclusions in scope.yaml and the
// "defines a function, method or class" test.
const GENERATED_MARKERS = ['@generated', 'Code generated'];
const GENERATED_HEAD_LINES = 5;
const MINIFIED_AVG_LINE_LENGTH = 300;
export function hasGeneratedMarker(text) {
    const head = text.split('\n', GENERATED_HEAD_LINES).join('\n');
    return GENERATED_MARKERS.some((marker) => head.includes(marker));
}
export function looksMinified(text) {
    if (text.length === 0)
        return false;
    const lines = text.split('\n').length;
    return text.length / lines > MINIFIED_AVG_LINE_LENGTH;
}
export function physicalLines(text) {
    if (text.length === 0)
        return 0;
    const parts = text.split('\n');
    return text.endsWith('\n') ? parts.length - 1 : parts.length;
}
