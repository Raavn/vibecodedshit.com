import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { z } from 'zod';
import {
  dimensionFileSchema,
  methodologyFileSchema,
  scopeFileSchema,
  type BandDef,
  type ParameterDef,
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

export interface Methodology {
  version: string;
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
    return {
      id: parsed.dimension.id,
      key: parsed.dimension.key,
      name: parsed.dimension.name,
      parameters: parsed.parameters,
    };
  });

  return {
    version,
    dimensions,
    capMargin: main.aggregation.dimension_to_health.cap_margin,
    bands: main.bands,
    scope,
  };
}
