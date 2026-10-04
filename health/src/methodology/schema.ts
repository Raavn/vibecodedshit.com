import { z } from 'zod';

const anchor = z.object({ raw: z.number(), score: z.number() });
const levelEntry = z.object({ level: z.string(), score: z.number() });

const component = z.object({
  key: z.string(),
  method: z.enum(['levels', 'ratio']),
  levels: z.array(levelEntry).optional(),
  definition: z.string().optional(),
  measure: z.string().optional(),
});

const scoring = z.discriminatedUnion('method', [
  z.object({ method: z.literal('piecewise_linear'), anchors: z.array(anchor).min(2) }),
  z.object({
    method: z.literal('levels'),
    levels: z.union([z.array(levelEntry), z.record(z.string(), z.array(levelEntry))]),
  }),
  z.object({ method: z.literal('mean_of_components'), components: z.array(component).min(1) }),
]);

export const parameterSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  layer: z.enum(['static', 'execution']),
  weight: z.number(),
  pooling: z.enum(['ratio', 'unit_weighted']),
  raw: z.object({ unit: z.string(), when_empty: z.number() }),
  scoring,
  /** Prose per language or topic, for example the 3.5 forbidden-import lists. */
  measure: z.record(z.string(), z.string()).optional(),
  not_applicable_when: z.string().nullable().optional(),
});

export const dimensionFileSchema = z.object({
  dimension: z.object({ id: z.number(), key: z.string(), name: z.string() }),
  /** Dimension 6 prose naming the recognised tools and the removed prefixes. */
  script_resolution: z.string().optional(),
  parameters: z.array(parameterSchema).min(1),
  presets: z.object({ files: z.array(z.string()) }).optional(),
});

const stringList = z.array(z.string());
const presetRule = z.object({
  name: z.string(),
  description: z.string(),
  from: z.object({ in: stringList.optional(), not_in: stringList.optional() }),
  to: z.object({ in: stringList.optional(), packages: stringList.optional() }),
  severity: z.enum(['error', 'warn', 'info']),
  type_only_imports: z.enum(['included', 'excluded']),
});

export const presetFileSchema = z.object({
  preset: z.object({
    key: z.enum(['nextjs', 'express', 'django', 'fastapi', 'generic']),
    name: z.string(),
    languages: stringList,
  }),
  conventions: z.string().optional(),
  /** Glob lists, or prose for content layers (nextjs `server_only` and `client`). */
  layers: z.record(z.string(), z.union([stringList, z.string()])),
  modules: z.object({
    roots: z.union([stringList, z.string()]),
    public_entry: z.union([z.string(), stringList, z.record(z.string(), z.string())]),
  }),
  rules: z.array(presetRule),
});

export const methodologyFileSchema = z.object({
  version: z.string(),
  dimensions: z.array(z.object({ id: z.number(), key: z.string(), file: z.string() })).min(1),
  aggregation: z.object({
    dimension_to_health: z.object({ cap_margin: z.number() }),
  }),
  bands: z
    .array(z.object({ key: z.string(), name: z.string(), min: z.number(), max: z.number() }))
    .min(1),
  execution: z.object({
    runner: z.object({ image: z.string(), cpus: z.number(), memory_gb: z.number() }),
    timeouts_seconds: z.object({
      install: z.number(),
      build: z.number(),
      typecheck: z.number(),
      lint: z.number(),
      tests: z.number(),
    }),
  }),
});

const globList = z.array(z.string());

export const scopeFileSchema = z.object({
  source_files: z.object({
    extensions: z.object({
      typescript: globList,
      javascript: globList,
      python: globList,
    }),
  }),
  exclusions: z.object({
    vendored: globList,
    build_output: globList,
    generated: globList,
    minified: globList,
    migrations: globList,
    declarations: globList,
  }),
  file_roles: z.object({
    test: z.object({ typescript_javascript: globList, python: globList }),
    config: globList,
  }),
});

export type ParameterDef = z.infer<typeof parameterSchema>;
export type ScoringDef = ParameterDef['scoring'];
export type LevelEntry = z.infer<typeof levelEntry>;
export type ComponentDef = z.infer<typeof component>;
export type ScopeConfig = z.infer<typeof scopeFileSchema>;
export type ExecutionConfig = z.infer<typeof methodologyFileSchema>['execution'];
export type BandDef = z.infer<typeof methodologyFileSchema>['bands'][number];

export type PresetRule = z.infer<typeof presetRule>;
export type PresetKey = z.infer<typeof presetFileSchema>['preset']['key'];
export interface Preset {
  preset: PresetKey;
  name: string;
  conventions?: string;
  languages: string[];
  layers: Record<string, string[] | string>;
  modules: z.infer<typeof presetFileSchema>['modules'];
  rules: PresetRule[];
}
