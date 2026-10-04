import { z } from 'zod';

const anchor = z.object({ raw: z.number(), score: z.number() });
const levelEntry = z.object({ level: z.string(), score: z.number() });

const component = z.object({
  key: z.string(),
  method: z.enum(['levels', 'ratio']),
  levels: z.array(levelEntry).optional(),
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
});

export const dimensionFileSchema = z.object({
  dimension: z.object({ id: z.number(), key: z.string(), name: z.string() }),
  parameters: z.array(parameterSchema).min(1),
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
export type BandDef = z.infer<typeof methodologyFileSchema>['bands'][number];
