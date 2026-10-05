export const edgeKey = (from, to) => `${from}\u0000${to}`;
/** Edges of the unit that count for 3.2: importer is not a test file. */
export function internalEdges(unit) {
    return unit.edges.filter((edge) => !edge.fromTest);
}
