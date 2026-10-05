const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Every dynamic string in the report goes through this: package names, paths and reasons are untrusted. */
export function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}
