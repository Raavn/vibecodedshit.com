/** Files with more than this many logic lines are large (methodology 4.2). */
const LARGE_FILE_LOGIC_LINES = 500;
export const p42 = {
    id: '4.2',
    layer: 'static',
    async measure({ scope }) {
        const units = new Map();
        for (const file of scope.files) {
            if (file.role !== 'logic')
                continue;
            const key = `${file.package}\0${file.group}`;
            const unit = units.get(key) ?? { package: file.package, group: file.group, large: 0, total: 0 };
            unit.total += file.logicLines;
            if (file.logicLines > LARGE_FILE_LOGIC_LINES)
                unit.large += file.logicLines;
            units.set(key, unit);
        }
        const ordered = [...units.values()].sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group));
        const result = ordered.map((unit) => ({
            package: unit.package,
            group: unit.group,
            weight: unit.total,
            raw: { kind: 'ratio', numerator: unit.large, denominator: unit.total, scale: 100 },
        }));
        return { status: 'measured', units: result };
    },
};
