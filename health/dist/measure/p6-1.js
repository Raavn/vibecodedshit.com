/** install_fails when the install did not work; build_fails when it did and the build did not; works otherwise (no build step counts as works). */
export function installLevel(root) {
    if (root.install && root.install.status !== 'ok')
        return 'install_fails';
    if (root.build && root.build.status !== 'ok')
        return 'build_fails';
    return 'works';
}
export const p61 = {
    id: '6.1',
    layer: 'execution',
    async measure({ exec }) {
        if (!exec)
            return { status: 'not_measured', reason: 'execution layer did not run' };
        return {
            status: 'measured',
            units: exec.roots.map((root) => ({ package: root.dir, group: root.group, weight: root.weight, raw: { kind: 'level', level: installLevel(root) } })),
        };
    },
};
