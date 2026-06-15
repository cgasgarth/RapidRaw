import { z } from 'zod';

const positiveIntegerSchema = z.number().int().positive();
const nonNegativeNumberSchema = z.number().min(0);
const positiveNumberSchema = z.number().positive();
const normalizedScalarSchema = z.number().min(0).max(1);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const metricRangeSchema = z
  .object({
    max: positiveNumberSchema,
    min: nonNegativeNumberSchema,
  })
  .strict()
  .refine((range) => range.min <= range.max, {
    message: 'Metric range min must be less than or equal to max.',
  });

const oddKernelSizeSchema = z
  .number()
  .int()
  .min(3)
  .max(31)
  .refine((value) => value % 2 === 1, {
    message: 'PSF kernel size must be odd.',
  });

export const deblurFixtureLimitationSchema = z.enum([
  'cpu_reference_deblur',
  'e2e_workflow',
  'preview_export_parity',
  'real_raw_quality',
  'runtime_deblur_quality',
  'ui_api',
]);

export const deblurFixtureKindSchema = z.enum([
  'failure_high_noise',
  'failure_motion_unknown',
  'failure_saturated_edge',
  'gaussian_edge_step',
  'gaussian_fine_texture',
  'gaussian_low_contrast_text',
]);

export const deblurArtifactKindSchema = z.enum([
  'expected_deblurred_reference',
  'ringing_metric_probe',
  'synthetic_blurred_input',
  'synthetic_clean_reference',
]);

export const deblurBasePatternSchema = z.enum([
  'fine_texture_patch',
  'high_noise_edge',
  'low_contrast_text',
  'motion_streak',
  'saturated_edge',
  'slanted_edge',
]);

export const deblurRejectionReasonSchema = z.enum([
  'halo_risk',
  'motion_psf_unknown',
  'noise_amplification_risk',
  'ringing_risk',
  'saturated_edge_risk',
]);

export const deblurArtifactSchema = z
  .object({
    hash: sha256Schema.nullable(),
    kind: deblurArtifactKindSchema,
    path: z.string().trim().min(1),
    publicRepoAllowed: z.boolean(),
  })
  .strict();

export const deblurExpectedMetricSchema = z
  .object({
    deltaEMax: metricRangeSchema,
    edgeAcutanceRatio: metricRangeSchema,
    falseEdgeRatio: metricRangeSchema,
    haloWidthPx: metricRangeSchema,
    noiseAmplificationRatio: metricRangeSchema,
    ringingOvershootRatio: metricRangeSchema,
    textureEnergyRatio: metricRangeSchema,
  })
  .strict();

export const deblurSyntheticGeneratorSchema = z
  .object({
    basePattern: deblurBasePatternSchema,
    blur: z
      .object({
        kernelSize: oddKernelSizeSchema,
        radiusPx: z.number().min(0.5).max(5),
        sigmaPx: z.number().min(0.25).max(2.5),
        type: z.literal('gaussian'),
      })
      .strict(),
    cleanReferenceHash: sha256Schema,
    degradation: z
      .object({
        motionBlurPx: nonNegativeNumberSchema.max(16),
        noiseSigma: normalizedScalarSchema.max(0.2),
        saturationFraction: normalizedScalarSchema.max(0.35),
      })
      .strict(),
    height: positiveIntegerSchema.max(1024),
    seed: z.string().trim().min(1),
    width: positiveIntegerSchema.max(1024),
  })
  .strict();

export const deblurAcceptancePolicySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('accept'),
      rejectionReasons: z.array(z.never()).length(0),
    })
    .strict(),
  z
    .object({
      action: z.literal('reject'),
      rejectionReasons: z.array(deblurRejectionReasonSchema).min(1),
    })
    .strict(),
]);

const deblurBaseFixtureSchema = z
  .object({
    acceptancePolicy: deblurAcceptancePolicySchema,
    artifacts: z.array(deblurArtifactSchema).min(2),
    expectedMetrics: deblurExpectedMetricSchema,
    fixtureId: z.string().regex(/^detail\.deblur\.[a-z0-9.-]+\.v[0-9]+$/u),
    kind: deblurFixtureKindSchema,
    notes: z.string().trim().min(1),
    stage: z.literal('scene_linear_post_denoise'),
  })
  .strict();

export const deblurSyntheticFixtureSchema = deblurBaseFixtureSchema.extend({
  generator: deblurSyntheticGeneratorSchema,
  privateRawEvidence: z.null(),
  sourceKind: z.literal('synthetic_public'),
});

export const deblurFixtureSchema = deblurSyntheticFixtureSchema;

export const deblurFixtureManifestSchema = z
  .object({
    $schema: z.url(),
    fixtures: z.array(deblurFixtureSchema).min(6),
    followUpIssues: z
      .object({
        cpuReference: z.literal(1180),
        e2eWorkflow: z.literal(1183),
        previewExportParity: z.literal(1150),
        realRawQuality: z.literal(1182),
        uiApi: z.literal(1181),
      })
      .strict(),
    issue: z.literal(1173),
    runtimeStatus: z.literal('validation_only'),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    validationScope: z
      .object({
        doesNotProve: z.array(deblurFixtureLimitationSchema).min(6),
        proves: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const requiredLimitations: Array<z.infer<typeof deblurFixtureLimitationSchema>> = [
      'cpu_reference_deblur',
      'e2e_workflow',
      'preview_export_parity',
      'real_raw_quality',
      'runtime_deblur_quality',
      'ui_api',
    ];
    for (const limitation of requiredLimitations) {
      if (!manifest.validationScope.doesNotProve.includes(limitation)) {
        context.addIssue({
          code: 'custom',
          message: `Deblur fixtures must not claim to prove ${limitation}.`,
          path: ['validationScope', 'doesNotProve'],
        });
      }
    }

    const fixtureIds = new Set<string>();
    const fixtureKinds = new Set<string>();

    for (const [fixtureIndex, fixture] of manifest.fixtures.entries()) {
      if (fixtureIds.has(fixture.fixtureId)) {
        context.addIssue({
          code: 'custom',
          message: 'Deblur fixture IDs must be unique.',
          path: ['fixtures', fixtureIndex, 'fixtureId'],
        });
      }
      fixtureIds.add(fixture.fixtureId);
      fixtureKinds.add(fixture.kind);

      if (fixture.acceptancePolicy.action === 'accept') {
        const artifactKinds = new Set(fixture.artifacts.map((artifact) => artifact.kind));
        const requiredArtifactKinds = [
          'synthetic_clean_reference',
          'synthetic_blurred_input',
          'expected_deblurred_reference',
          'ringing_metric_probe',
        ] as const;
        for (const requiredKind of requiredArtifactKinds) {
          if (!artifactKinds.has(requiredKind)) {
            context.addIssue({
              code: 'custom',
              message: `Accepted synthetic deblur fixtures require ${requiredKind}.`,
              path: ['fixtures', fixtureIndex, 'artifacts'],
            });
          }
        }
      }
    }

    for (const fixtureKind of [
      'gaussian_edge_step',
      'gaussian_fine_texture',
      'gaussian_low_contrast_text',
      'failure_high_noise',
      'failure_motion_unknown',
      'failure_saturated_edge',
    ]) {
      if (!fixtureKinds.has(fixtureKind)) {
        context.addIssue({
          code: 'custom',
          message: `Deblur fixture manifest must include a ${fixtureKind} fixture.`,
          path: ['fixtures'],
        });
      }
    }
  });

export type DeblurFixture = z.infer<typeof deblurFixtureSchema>;
export type DeblurFixtureManifest = z.infer<typeof deblurFixtureManifestSchema>;

export function parseDeblurFixtureManifest(value: unknown): DeblurFixtureManifest {
  return deblurFixtureManifestSchema.parse(value);
}
