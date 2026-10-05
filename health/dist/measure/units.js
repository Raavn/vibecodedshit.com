export function logicFiles(scope, group) {
    return scope.files.filter((f) => f.role === 'logic' && f.group === group);
}
export function unitId(file) {
    return `${file.package}\0${file.group}`;
}
/** One tally per (package, group) that has logic files, weight = logic lines of the unit. */
export function emptyTallies(files) {
    const tallies = new Map();
    for (const file of files) {
        const key = unitId(file);
        const tally = tallies.get(key) ?? { package: file.package, group: file.group, weight: 0, numerator: 0, denominator: 0 };
        tally.weight += file.logicLines;
        tallies.set(key, tally);
    }
    return tallies;
}
export function tallyUnits(tallies) {
    return [...tallies.values()]
        .sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group))
        .map((t) => ({
        package: t.package,
        group: t.group,
        weight: t.weight,
        raw: { kind: 'ratio', numerator: t.numerator, denominator: t.denominator, scale: 100 },
    }));
}
/** One unit per (workspace package, language group) that has at least one logic-role file, sorted by package then group. */
export function logicUnits(scope) {
    const units = new Map();
    for (const file of scope.files) {
        if (file.role !== 'logic')
            continue;
        const key = unitId(file);
        const unit = units.get(key) ?? { package: file.package, group: file.group, dir: file.package, weight: 0, files: [] };
        unit.weight += file.logicLines;
        unit.files.push(file);
        units.set(key, unit);
    }
    return [...units.values()].sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group));
}
