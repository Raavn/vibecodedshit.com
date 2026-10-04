import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { z } from 'zod';
import {
  dimensionFileSchema,
  methodologyFileSchema,
  presetFileSchema,
  scopeFileSchema,
  type BandDef,
  type ParameterDef,
  type Preset,
  type PresetKey,
  type ScopeConfig,
} from './schema.js';

export class MethodologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MethodologyError';
  }
}

export interface DimensionDef {
  id: number;
  key: string;
  name: string;
  parameters: ParameterDef[];
}

/** Lists the 3.5 YAML states in prose, parsed once here. */
export interface D3Lists {
  /** Package names, `node:` folded away. */
  forbiddenImports: { typescript_javascript: string[]; python: string[] };
  infrastructureDirectories: string[];
}

export interface Methodology {
  version: string;
  presets: Partial<Record<PresetKey, Preset>>;
  d3: D3Lists;
  dimensions: DimensionDef[];
  capMargin: number;
  bands: BandDef[];
  scope: ScopeConfig;
}

/** Package root: the directory holding `methodology/`, both from `src/` and from `dist/`. */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readYaml<T extends z.ZodType>(file: string, schema: T): z.infer<T> {
  let doc: unknown;
  try {
    doc = parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new MethodologyError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = schema.safeParse(doc);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)';
    throw new MethodologyError(`${file}: ${where}: ${issue?.message ?? 'invalid'}`);
  }
  return result.data;
}

function commaList(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim().replace(/^node:/, ''))
    .filter((entry) => entry !== '');
}

export function parseD3Lists(def: ParameterDef | undefined, file = 'dimension 3'): D3Lists {
  const lists: D3Lists = { forbiddenImports: { typescript_javascript: [], python: [] }, infrastructureDirectories: [] };
  if (!def) return lists;
  const measure = def.measure ?? {};
  for (const group of ['typescript_javascript', 'python'] as const) {
    const match = /Forbidden imports:\s*(.+?)\.(?:\s|$)/s.exec(measure[group] ?? '');
    if (!match?.[1]) throw new MethodologyError(`${file}: parameter ${def.id} measure.${group} has no "Forbidden imports:" list`);
    lists.forbiddenImports[group] = [...new Set(commaList(match[1]))];
  }
  const infra = (measure.infrastructure_directories ?? '').replace(/\.\s*$/, '');
  lists.infrastructureDirectories = commaList(infra);
  if (lists.infrastructureDirectories.length === 0) {
    throw new MethodologyError(`${file}: parameter ${def.id} measure.infrastructure_directories is empty`);
  }
  return lists;
}

export function loadMethodology(version: string, rootDir: string = packageRoot): Methodology {
  if (!/^\d+\.\d+$/.test(version)) {
    throw new MethodologyError(`Unknown methodology version "${version}"`);
  }
  const dir = path.join(rootDir, 'methodology', `v${version}`);
  if (!existsSync(dir)) {
    throw new MethodologyError(`Unknown methodology version "${version}" (no ${dir})`);
  }

  const main = readYaml(path.join(dir, 'methodology.yaml'), methodologyFileSchema);
  if (main.version !== version) {
    throw new MethodologyError(
      `${path.join(dir, 'methodology.yaml')}: version "${main.version}" does not match directory v${version}`,
    );
  }
  const scope = readYaml(path.join(dir, 'scope.yaml'), scopeFileSchema);

  const presets: Partial<Record<PresetKey, Preset>> = {};
  const dimensions: DimensionDef[] = main.dimensions.map((entry) => {
    const file = path.join(dir, entry.file);
    const parsed = readYaml(file, dimensionFileSchema);
    if (parsed.dimension.id !== entry.id || parsed.dimension.key !== entry.key) {
      throw new MethodologyError(`${file}: dimension id/key do not match methodology.yaml`);
    }
    const total = parsed.parameters.reduce((sum, p) => sum + p.weight, 0);
    if (Math.abs(total - 100) > 1e-9) {
      throw new MethodologyError(`${file}: parameter weights sum to ${total}, expected 100`);
    }
    for (const presetFile of parsed.presets?.files ?? []) {
      const loaded = readYaml(path.join(dir, presetFile), presetFileSchema);
      presets[loaded.preset.key] = {
        preset: loaded.preset.key,
        name: loaded.preset.name,
        ...(loaded.conventions === undefined ? {} : { conventions: loaded.conventions }),
        languages: loaded.preset.languages,
        layers: loaded.layers,
        modules: loaded.modules,
        rules: loaded.rules,
      };
    }
    return {
      id: parsed.dimension.id,
      key: parsed.dimension.key,
      name: parsed.dimension.name,
      parameters: parsed.parameters,
    };
  });

  const d3Def = dimensions.find((d) => d.id === 3)?.parameters.find((p) => p.id === '3.5');
  return {
    version,
    presets,
    d3: parseD3Lists(d3Def, path.join(dir, 'dimensions')),
    dimensions,
    capMargin: main.aggregation.dimension_to_health.cap_margin,
    bands: main.bands,
    scope,
  };
}
