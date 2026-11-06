/**
 * The fixed order Slices are written in (ADR 0001): secrets and known vulnerabilities, then the repo installs, builds
 * and verifies, then the safety net, then types and lint, then CI and docs. Structural refactors and major upgrades
 * (3.x, 4.x, 5.2) come last. It is advice about working order, so it lives here and not in the methodology YAML.
 */
const PRECEDENCE = [
    '5.4', '5.1',
    '6.1', '5.3', '5.5', '6.2', '6.5',
    '1.1', '1.4', '1.2', '1.3', '1.5',
    '2.1', '2.2', '2.5', '2.3', '2.4',
    '6.4', '6.6', '6.3',
];
const LAST_GROUPS = ['3', '4'];
/** Lower ranks are written first. Parameters not in the list go last: 3.x, then 4.x, then everything else (5.2). */
export function precedenceRank(id) {
    const listed = PRECEDENCE.indexOf(id);
    if (listed >= 0)
        return listed;
    const [dimension = '', index = '0'] = id.split('.');
    const group = LAST_GROUPS.indexOf(dimension);
    return PRECEDENCE.length + (group >= 0 ? group : LAST_GROUPS.length) * 100 + Number(index);
}
