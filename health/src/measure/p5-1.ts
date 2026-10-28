import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { packageOf } from '../scope/packages.js';
import type { Group } from '../scope/types.js';
import { failureReason, unavailable } from '../tools/outcome.js';
import { joinRel } from './deps/files.js';
import { kindGroup, type LockfileRef } from './deps/lockfiles.js';
import { parseOsvReport, severityPoints, type PackageVulns } from './deps/osv.js';
import { unitDeps } from './deps/resolved.js';
import { scopeUnits } from './deps/units.js';
import type { Measurement, MeasureContext, Measurer, UnitRaw } from './types.js';

const OK_CODES = [0, 1, 128];

interface Scanned {
  ref: LockfileRef;
  packages: PackageVulns[];
}

/** One osv-scanner run on one lockfile. Flags are written from the osv-scanner v2 documentation. */
async function scanLockfile(ctx: MeasureContext, ref: LockfileRef): Promise<Scanned | Measurement> {
  const tool = await ctx.tools.resolve('osv-scanner');
  if (!tool) return unavailable(ctx.tools.notFoundReason('osv-scanner'));
  const major = semver.coerce(tool.version)?.major;
  if (major === undefined || major < 2) return unavailable(`osv-scanner 2.x required, found ${tool.version}`);
  const abs = path.join(ctx.repoPath, ref.path);
  const lockArg = ref.kind === 'requirements' && path.posix.basename(ref.path) !== 'requirements.txt' ? `requirements.txt:${abs}` : abs;
  const outDir = await mkdtemp(path.join(tmpdir(), 'health-osv-'));
  try {
    const report = path.join(outDir, 'osv.json');
    const result = await ctx.tools.run(
      tool,
      ['scan', '-L', lockArg, '--format', 'json', '--output-file', report, '--all-packages'],
      { cwd: path.join(ctx.repoPath, ref.dir) },
    );
    const failure = failureReason(tool, result, OK_CODES);
    if (failure) return unavailable(failure);
    let text: string;
    try {
      text = await readFile(report, 'utf8');
    } catch {
      if (result.exitCode === 128) return { ref, packages: [] };
      return unavailable('osv-scanner wrote no report');
    }
    const packages = parseOsvReport(text);
    if (!packages) return unavailable('osv-scanner report has an unexpected shape');
    return { ref, packages };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

function isScanned(value: Scanned | Measurement): value is Scanned {
  return 'ref' in value;
}

export const p51: Measurer = {
  id: '5.1',
  layer: 'static',
  async measure(ctx) {
    const warnings: string[] = [];
    const lockfiles = new Map<string, LockfileRef>();
    for (const unit of scopeUnits(ctx)) {
      const deps = await unitDeps(ctx, unit.package, unit.group);
      if (deps.lockfiles.length === 0) {
        warnings.push(`5.1: ${unit.package} has no lockfile, its dependencies were not scanned`);
        continue;
      }
      for (const { ref } of deps.lockfiles) lockfiles.set(ref.path, ref);
    }

    const weights = new Map(scopeUnits(ctx).map((u) => [`${u.package}\0${u.group}`, u.weight]));
    const perUnit = new Map<string, { package: string; group: Group; points: number }>();
    const devAdvisories: { package: string; name: string; version: string; id: string; severity: string }[] = [];
    let devPoints = 0;
    const resolvedPackages: unknown[] = [];

    for (const ref of [...lockfiles.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const scanned = await scanLockfile(ctx, ref);
      if (!isScanned(scanned)) return scanned;
      const group = kindGroup(ref.kind);
      const owner = packageOf(joinRel(ref.dir, 'x'), ctx.scope.packages);
      const key = `${owner}\0${group}`;
      const unit = perUnit.get(key) ?? { package: owner, group, points: 0 };
      const production = scanned.packages.filter((p) => !p.dev);
      unit.points += severityPoints(production, ctx.asOf).points;
      perUnit.set(key, unit);
      const dev = severityPoints(scanned.packages.filter((p) => p.dev), ctx.asOf);
      devPoints += dev.points;
      for (const a of dev.advisories) {
        devAdvisories.push({ package: owner, name: a.name, version: a.version, id: a.id, severity: a.severity });
      }
      for (const p of scanned.packages) {
        resolvedPackages.push({ package: owner, group, ecosystem: p.ecosystem, name: p.name, version: p.version, dev: p.dev });
      }
    }

    const units: UnitRaw[] = [...perUnit.values()]
      .sort((a, b) => a.package.localeCompare(b.package) || a.group.localeCompare(b.group))
      .map((u) => ({
        package: u.package,
        group: u.group,
        weight: weights.get(`${u.package}\0${u.group}`) ?? 0,
        raw: { kind: 'number', value: u.points },
      }));
    return {
      status: 'measured',
      units,
      warnings,
      reportOnly: {
        devDependencyVulnerabilities: { points: devPoints, advisories: devAdvisories },
        resolvedPackages,
      },
    };
  },
};
