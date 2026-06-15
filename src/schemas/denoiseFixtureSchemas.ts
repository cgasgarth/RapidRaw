import { z } from 'zod';

const positiveIntegerSchema = z.number().int().positive();
const normalizedScalarSchema = z.number().min(0).max(1);
const positiveNumberSchema = z.number().positive();
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const metricRangeSchema = z
  .object({
    max: positiveNumberSchema,
    min: z.number().min(0),
  })
  .strict()
  .refine((range) => range.min <= range.max, {
    message: 'Metric range min must be less than or equal to max.',
  });

export const denoiseFixtureLimitationSchema = z.enum([
  'e2e_workflow',
  'preview_export_parity',
  'real_raw_quality',
  'runtime_denoise_quality',
]);

export const denoiseFixtureKindSchema = z.enum([
  'chroma_edge',
  'fine_texture',
  'flat_shadow',
  'private_high_iso_chroma',
]);

export const denoiseArtifactKindSchema = z.enum([
  'expected_denoised_reference',
  'export_artifact_placeholder',
  'preview_artifact_placeholder',
  'private_raw_crop_placeholder',
  'synthetic_clean_reference',
  'synthetic_noisy_input',
]);

export const denoiseArtifactSchema = z
  .object({
    hash: sha256Schema.nullable(),
    kind: denoiseArtifactKindSchema,
    path: z.string().trim().min(1),
    publicRepoAllowed: z.boolean(),
  })
  .strict();

export const denoiseExpectedMetricSchema = z
  .object({
    chromaSigmaAfter: metricRangeSchema,
    deltaEMax: metricRangeSchema,
    edgePreservationRatio: metricRangeSchema,
    lumaSigmaAfter: metricRangeSchema,
    textureEnergyRatio: metricRangeSchema,
  })
  .strict();

const denoiseBaseFixtureSchema = z
  .object({
    artifacts: z.array(denoiseArtifactSchema).min(2),
    expectedMetrics: denoiseExpectedMetricSchema,
    fixtureId: z.string().regex(/^detail\.denoise\.[a-z0-9.-]+\.v[0-9]+$/u),
    iso: z.number().int().min(100).max(1_638_400),
    kind: denoiseFixtureKindSchema,
    notes: z.string().trim().min(1),
    stage: z.literal('scene_linear_post_demosaic'),
  })
  .strict();

export const denoiseSyntheticFixtureSchema = denoiseBaseFixtureSchema.extend({
  generator: z
    .object({
      basePattern: z.enum(['chroma_edge', 'flat_shadow_ramp', 'fine_texture_patch']),
      chromaNoiseSigma: normalizedScalarSchema.max(0.25),
      cleanReferenceHash: sha256Schema,
      height: positiveIntegerSchema.max(1024),
      lumaNoiseSigma: normalizedScalarSchema.max(0.25),
      seed: z.string().trim().min(1),
      width: positiveIntegerSchema.max(1024),
    })
    .strict(),
  privateRawEvidence: z.null(),
  sourceKind: z.literal('synthetic_public'),
});

export const denoisePrivateRawFixtureSchema = denoiseBaseFixtureSchema.extend({
  generator: z.null(),
  privateRawEvidence: z
    .object({
      cropHash: sha256Schema.nullable(),
      evidenceId: z.string().regex(/^raw-evidence\.[a-z0-9.-]+\.v[0-9]+$/u),
      localRelativePath: z.string().trim().min(1),
      rightsStatus: z.enum(['planned_private_capture', 'private_asset_available']),
      sourceHash: sha256Schema.nullable(),
    })
    .strict(),
  sourceKind: z.literal('private_raw_placeholder'),
});

export const denoiseFixtureSchema = z.discriminatedUnion('sourceKind', [
  denoiseSyntheticFixtureSchema,
  denoisePrivateRawFixtureSchema,
]);

export const denoiseFixtureManifestSchema = z
  .object({
    $schema: z.url(),
    fixtures: z.array(denoiseFixtureSchema).min(2),
    followUpIssues: z
      .object({
        cpuReference: z.literal(1172),
        e2eWorkflow: z.literal(1177),
        previewExportParity: z.literal(1150),
        uiApi: z.literal(1176),
      })
      .strict(),
    issue: z.literal(1171),
    runtimeStatus: z.literal('validation_only'),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    validationScope: z
      .object({
        doesNotProve: z.array(denoiseFixtureLimitationSchema).min(4),
        proves: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const requiredLimitations: Array<z.infer<typeof denoiseFixtureLimitationSchema>> = [
      'e2e_workflow',
      'preview_export_parity',
      'real_raw_quality',
      'runtime_denoise_quality',
    ];
    for (const limitation of requiredLimitations) {
      if (!manifest.validationScope.doesNotProve.includes(limitation)) {
        context.addIssue({
          code: 'custom',
          message: `Denoise fixtures must not claim to prove ${limitation}.`,
          path: ['validationScope', 'doesNotProve'],
        });
      }
    }

    const fixtureIds = new Set<string>();
    const sourceKinds = new Set<string>();
    const fixtureKinds = new Set<string>();
    for (const [fixtureIndex, fixture] of manifest.fixtures.entries()) {
      if (fixtureIds.has(fixture.fixtureId)) {
        context.addIssue({
          code: 'custom',
          message: 'Denoise fixture IDs must be unique.',
          path: ['fixtures', fixtureIndex, 'fixtureId'],
        });
      }
      fixtureIds.add(fixture.fixtureId);
      sourceKinds.add(fixture.sourceKind);
      fixtureKinds.add(fixture.kind);

      if (fixture.sourceKind === 'private_raw_placeholder') {
        const hasPrivatePlaceholderArtifact = fixture.artifacts.some(
          (artifact) => artifact.kind === 'private_raw_crop_placeholder' && !artifact.publicRepoAllowed,
        );
        if (!hasPrivatePlaceholderArtifact) {
          context.addIssue({
            code: 'custom',
            message: 'Private RAW placeholders require a non-public private raw crop artifact placeholder.',
            path: ['fixtures', fixtureIndex, 'artifacts'],
          });
        }
      }
    }

    for (const sourceKind of ['synthetic_public', 'private_raw_placeholder']) {
      if (!sourceKinds.has(sourceKind)) {
        context.addIssue({
          code: 'custom',
          message: `Denoise fixture manifest must include ${sourceKind}.`,
          path: ['fixtures'],
        });
      }
    }

    for (const fixtureKind of ['chroma_edge', 'fine_texture', 'flat_shadow']) {
      if (!fixtureKinds.has(fixtureKind)) {
        context.addIssue({
          code: 'custom',
          message: `Denoise fixture manifest must include a ${fixtureKind} fixture.`,
          path: ['fixtures'],
        });
      }
    }
  });

export type DenoiseFixture = z.infer<typeof denoiseFixtureSchema>;
export type DenoiseFixtureManifest = z.infer<typeof denoiseFixtureManifestSchema>;

export function parseDenoiseFixtureManifest(value: unknown): DenoiseFixtureManifest {
  return denoiseFixtureManifestSchema.parse(value);
}
