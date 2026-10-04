import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'smol-toml';
import { packageOf } from '../scope/packages.js';
import { isOutcome, runKnip, type KnipOutcome } from '../tools/knip.js';
import { failureReason, notFoundReason, unavailable } from '../tools/outcome.js';
import { createWorkCopy } from '../tools/workcopy.js';
import { readToml } from '../util/toml.js';
import { requirementFiles } from './deps/declared.js';
import { joinRel, trackedSet } from './deps/files.js';
import { unitDeps } from './deps/resolved.js';
import { scopeUnits } from './deps/units.js';
import type { Measurement, MeasureContext, Measurer } from './types.js';
import type { ToolKit } from '../tools/kit.js';

interface Counts {
  numerator: number;
  denominator: number;
}

function knipCounts(ctx: MeasureContext, knip: KnipOutcome, pkg: string): number {
  const names = new Set<string>();
  const manifest = joinRel(pkg, 'package.json');
  for (const [file, issues] of knip.files) {
    if (file === manifest) {
      for (const name of [...issues.dependencies, ...issues.devDependencies]) names.add(name);
    }
    if (packageOf(file, ctx.scope.packages) === pkg) {
      for (const name of issues.unlisted) names.add(`unlisted\0${name}`);
    }
  }
  return names.size;
}

const DEPTRY_CODES = new Set(['DEP001', 'DEP002', 'DEP003']);

/** deptry on a work copy of the unit with the repository's [tool.deptry] settings removed. */
async function deptryCount(ctx: MeasureContext, tools: ToolKit, pkg: string): Promise<number | Measurement> {
  const tool = await tools.resolve('deptry');
  if (!tool) return unavailable(ctx, notFoundReason('deptry'));
  const dir = pkg === '.' ? '' : pkg;
  const pythonFiles = [...trackedSet(ctx.repoPath)].filter(
    (f) => f.endsWith('.py') && (dir === '' || f.startsWith(`${dir}/`)) && packageOf(f, ctx.scope.packages) === pkg,
  );
  const extra = [...requirementFiles(ctx.repoPath, pkg)];
  const pipfile = joinRel(dir, 'Pipfile');
  if (trackedSet(ctx.repoPath).has(pipfile)) extra.push(pipfile);
  const copy = await createWorkCopy(ctx.repoPath, [...pythonFiles, ...extra]);
  const outDir = await mkdtemp(path.join(tmpdir(), 'health-deptry-'));
  try {
    const pyprojectRel = joinRel(dir, 'pyproject.toml');
    if (trackedSet(ctx.repoPath).has(pyprojectRel)) {
      const doc = readToml(path.join(ctx.repoPath, pyprojectRel));
      if (doc) {
        const toolTable = doc.tool;
        if (toolTable !== null && typeof toolTable === 'object' && !Array.isArray(toolTable)) {
          delete (toolTable as Record<string, unknown>).deptry;
        }
        await writeFile(path.join(copy.dir, pyprojectRel), stringify(doc));
      }
    }
    const report = path.join(outDir, 'deptry.json');
    const result = await tools.run(tool, ['.', '--json-output', report, '--no-ansi'], { cwd: path.join(copy.dir, dir) });
    const failure = failureReason(tool, result, [0, 1]);
    if (failure) return unavailable(ctx, failure);
    let text = '[]';
    try {
      text = await readFile(report, 'utf8');
    } catch {
      if (result.exitCode === 1) return unavailable(ctx, 'deptry wrote no report');
    }
    let violations: unknown;
    try {
      violations = JSON.parse(text.trim() === '' ? '[]' : text);
    } catch {
      return unavailable(ctx, 'deptry printed no parseable JSON report');
    }
    if (!Array.isArray(violations)) return unavailable(ctx, 'deptry report has an unexpected shape');
    const pairs = new Set<string>();
    for (const entry of violations as { error?: { code?: unknown }; module?: unknown }[]) {
      const code = entry.error?.code;
      if (typeof code === 'string' && DEPTRY_CODES.has(code)) pairs.add(`${code}\0${String(entry.module)}`);
    }
    return pairs.size;
  } finally {
    await copy.cleanup();
    await rm(outDir, { recursive: true, force: true });
  }
}

export const p55: Measurer = {
  id: '5.5',
  layer: 'static',
  async measure(ctx) {
    const units = scopeUnits(ctx);
    const warnings: string[] = [];
    const counts = new Map<string, Counts>();

    if (units.some((u) => u.group === 'typescript_javascript')) {
      const knip = await runKnip(ctx);
      if (!isOutcome(knip)) return knip;
      for (const unit of units.filter((u) => u.group === 'typescript_javascript')) {
        const deps = await unitDeps(ctx, unit.package, unit.group);
        if (!deps.manifest) {
          warnings.push(`5.5: ${unit.package} has no package.json`);
          counts.set(`${unit.package}\0${unit.group}`, { numerator: 0, denominator: 0 });
          continue;
        }
        const denominator = deps.manifest.deps.filter((d) => d.optional !== true).length;
        counts.set(`${unit.package}\0${unit.group}`, { numerator: knipCounts(ctx, knip, unit.package), denominator });
      }
    }

    for (const unit of units.filter((u) => u.group === 'python')) {
      const deps = await unitDeps(ctx, unit.package, unit.group);
      const denominator = new Set((deps.manifest?.deps ?? []).map((d) => d.name)).size;
      if (denominator === 0) warnings.push(`5.5: ${unit.package} declares no dependencies`);
      const numerator = await deptryCount(ctx, ctx.tools, unit.package);
      if (typeof numerator !== 'number') return numerator;
      counts.set(`${unit.package}\0${unit.group}`, { numerator, denominator });
    }

    return {
      status: 'measured',
      units: units.map((u) => {
        const c = counts.get(`${u.package}\0${u.group}`) ?? { numerator: 0, denominator: 0 };
        return { package: u.package, group: u.group, weight: u.weight, raw: { kind: 'ratio', numerator: c.numerator, denominator: c.denominator, scale: 100 } };
      }),
      warnings,
    };
  },
};
