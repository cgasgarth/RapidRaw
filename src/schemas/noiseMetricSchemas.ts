import { z } from 'zod';

const positiveIntegerSchema = z.number().int().positive();
const nonNegativeNumberSchema = z.number().min(0);

export const noiseMetricLimitationSchema = z.enum([
  'real_raw_quality',
  'preview_export_parity',
  'runtime_denoise_quality',
]);

export const noiseMetricRegionSchema = z
  .object({
    height: positiveIntegerSchema,
    id: z.string().regex(/^[a-z0-9.-]+$/u),
    width: positiveIntegerSchema,
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

export const noiseMetricExpectedRangeSchema = z
  .object({
    max: nonNegativeNumberSchema,
    min: nonNegativeNumberSchema,
  })
  .strict()
  .refine((range) => range.min <= range.max, {
    message: 'Expected metric range min must be less than or equal to max.',
  });

export const noiseMetricCaseSchema = z
  .object({
    description: z.string().trim().min(1),
    expectedMetrics: z
      .object({
        chromaSigma: noiseMetricExpectedRangeSchema,
        edgeContrast: noiseMetricExpectedRangeSchema,
        highFrequencyEnergy: noiseMetricExpectedRangeSchema,
        lumaSigma: noiseMetricExpectedRangeSchema,
        textureEnergy: noiseMetricExpectedRangeSchema,
      })
      .strict(),
    generator: z
      .object({
        basePattern: z.enum(['flat_patch_edge_texture', 'chroma_speckle_edge_texture']),
        chromaNoiseSigma: nonNegativeNumberSchema.max(0.25),
        lumaNoiseSigma: nonNegativeNumberSchema.max(0.25),
        seed: z.string().trim().min(1),
      })
      .strict(),
    height: positiveIntegerSchema.max(512),
    id: z.string().regex(/^detail\.noise\.[a-z0-9.-]+\.v[0-9]+$/u),
    regions: z
      .object({
        edge: noiseMetricRegionSchema,
        flatPatch: noiseMetricRegionSchema,
        texture: noiseMetricRegionSchema,
      })
      .strict(),
    sourceKind: z.literal('synthetic_public'),
    warningThresholds: z
      .object({
        chromaDominanceRatio: nonNegativeNumberSchema,
        minEdgeContrast: nonNegativeNumberSchema,
        minTextureEnergy: nonNegativeNumberSchema,
      })
      .strict(),
    width: positiveIntegerSchema.max(512),
  })
  .strict();

export const noiseMetricFixtureManifestSchema = z
  .object({
    cases: z.array(noiseMetricCaseSchema).min(1),
    metricVersion: z.literal(1),
    runtimeStatus: z.literal('synthetic_validation'),
    schemaVersion: z.literal(1),
    validationScope: z
      .object({
        doesNotProve: z.array(noiseMetricLimitationSchema).min(3),
        proves: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const requiredLimitations: Array<z.infer<typeof noiseMetricLimitationSchema>> = [
      'real_raw_quality',
      'preview_export_parity',
      'runtime_denoise_quality',
    ];
    for (const limitation of requiredLimitations) {
      if (!manifest.validationScope.doesNotProve.includes(limitation)) {
        context.addIssue({
          code: 'custom',
          message: `Noise metric fixtures must not claim to prove ${limitation}.`,
          path: ['validationScope', 'doesNotProve'],
        });
      }
    }

    const caseIds = new Set<string>();
    for (const [caseIndex, fixtureCase] of manifest.cases.entries()) {
      if (caseIds.has(fixtureCase.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Noise metric case IDs must be unique.',
          path: ['cases', caseIndex, 'id'],
        });
      }
      caseIds.add(fixtureCase.id);

      const regionIds = new Set<string>();
      for (const [regionName, region] of Object.entries(fixtureCase.regions)) {
        if (regionIds.has(region.id)) {
          context.addIssue({
            code: 'custom',
            message: 'Noise metric region IDs must be unique within each case.',
            path: ['cases', caseIndex, 'regions', regionName, 'id'],
          });
        }
        regionIds.add(region.id);

        if (region.x + region.width > fixtureCase.width || region.y + region.height > fixtureCase.height) {
          context.addIssue({
            code: 'custom',
            message: 'Noise metric regions must fit inside the generated fixture dimensions.',
            path: ['cases', caseIndex, 'regions', regionName],
          });
        }
      }
    }
  });

export type NoiseMetricCase = z.infer<typeof noiseMetricCaseSchema>;
export type NoiseMetricFixtureManifest = z.infer<typeof noiseMetricFixtureManifestSchema>;

export function parseNoiseMetricFixtureManifest(value: unknown): NoiseMetricFixtureManifest {
  return noiseMetricFixtureManifestSchema.parse(value);
}
