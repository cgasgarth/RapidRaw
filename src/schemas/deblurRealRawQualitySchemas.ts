import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const metricRangeSchema = z
  .object({
    max: z.number().positive(),
    min: z.number().min(0),
  })
  .strict()
  .refine((range) => range.min <= range.max, {
    message: 'Metric range min must be less than or equal to max.',
  });

const artifactSchema = z
  .object({
    hash: sha256Schema.nullable(),
    kind: z.enum([
      'private_raw_crop_placeholder',
      'preview_before_placeholder',
      'preview_after_placeholder',
      'export_after_placeholder',
      'ringing_probe_placeholder',
      'manual_review_notes_placeholder',
    ]),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const qualityCaseSchema = z
  .object({
    acceptanceStatus: z.enum(['pending_private_asset', 'accepted_private_asset', 'rejected_private_asset']),
    artifactClass: z.enum(['edge_halo_ringing', 'fine_texture_detail', 'lens_softness', 'motion_blur']),
    artifacts: z.array(artifactSchema).min(4),
    evidenceId: z.string().regex(/^raw-evidence\.[a-z0-9.-]+\.v[0-9]+$/u),
    expectedMetrics: z
      .object({
        edgeAcutanceRatio: metricRangeSchema,
        falseEdgeRatio: metricRangeSchema,
        haloWidthPx: metricRangeSchema,
        noiseAmplificationRatio: metricRangeSchema,
        ringingOvershootRatio: metricRangeSchema,
        textureEnergyRatio: metricRangeSchema,
      })
      .strict(),
    fixtureId: z.string().regex(/^detail\.deblur\.real-raw\.[a-z0-9.-]+\.v[0-9]+$/u),
    localRelativePath: z.string().trim().min(1),
    manualReviewChecklist: z.array(z.string().trim().min(1)).min(4),
    notes: z.string().trim().min(1),
    rightsStatus: z.enum(['planned_private_capture', 'private_asset_available']),
  })
  .strict()
  .superRefine((qualityCase, context) => {
    const artifactKinds = new Set(qualityCase.artifacts.map((artifact) => artifact.kind));
    for (const requiredKind of [
      'private_raw_crop_placeholder',
      'preview_before_placeholder',
      'preview_after_placeholder',
      'export_after_placeholder',
      'ringing_probe_placeholder',
    ] as const) {
      if (!artifactKinds.has(requiredKind)) {
        context.addIssue({
          code: 'custom',
          message: `Deblur real RAW quality cases require ${requiredKind}.`,
          path: ['artifacts'],
        });
      }
    }

    if (
      qualityCase.acceptanceStatus === 'pending_private_asset' &&
      qualityCase.rightsStatus !== 'planned_private_capture'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pending private asset cases must keep rightsStatus planned_private_capture.',
        path: ['rightsStatus'],
      });
    }
  });

export const deblurRealRawQualityManifestSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(1182),
    qualityCases: z.array(qualityCaseSchema).min(1),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    validationMode: z.literal('schema_public_assets_private'),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.qualityCases.map((qualityCase) => qualityCase.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Deblur real RAW quality fixture IDs must be unique.',
        path: ['qualityCases'],
      });
    }
  });

export type DeblurRealRawQualityManifest = z.infer<typeof deblurRealRawQualityManifestSchema>;

export function parseDeblurRealRawQualityManifest(value: unknown): DeblurRealRawQualityManifest {
  return deblurRealRawQualityManifestSchema.parse(value);
}
