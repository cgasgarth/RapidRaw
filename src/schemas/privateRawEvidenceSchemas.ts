import { z } from 'zod';

import { privateRawFormatSchema } from './privateRawFormatSchemas';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const positiveNumberSchema = z.number().positive();

const cropRectangleSchema = z
  .object({
    height: z.number().int().positive(),
    unit: z.literal('source_pixels'),
    width: z.number().int().positive(),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

const exposureMetadataSchema = z
  .object({
    aperture: positiveNumberSchema.optional(),
    exposureBiasEv: z.number().optional(),
    iso: z.number().int().positive(),
    shutterSeconds: positiveNumberSchema,
  })
  .strict();

const cameraMetadataSchema = z
  .object({
    cameraMake: z.string().trim().min(1),
    cameraModel: z.string().trim().min(1),
    lens: z.string().trim().min(1).optional(),
    rawFormat: privateRawFormatSchema,
  })
  .strict();

const rightsSchema = z
  .object({
    allowedUse: z.enum(['local_validation_only', 'private_ci_validation', 'public_repo_redistribution']),
    copyrightOwner: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    publicRepoAllowed: z.boolean(),
    rightsStatus: z.enum(['project_owned', 'user_provided', 'third_party_restricted']),
  })
  .strict()
  .superRefine((rights, context) => {
    if (rights.publicRepoAllowed && rights.allowedUse !== 'public_repo_redistribution') {
      context.addIssue({
        code: 'custom',
        message: 'publicRepoAllowed requires public_repo_redistribution allowedUse.',
        path: ['allowedUse'],
      });
    }
  });

export const privateRawEvidenceArtifactClassSchema = z.enum([
  'bracket_alignment',
  'focus_plane_transition',
  'high_iso_chroma_noise',
  'high_iso_luma_noise',
  'fine_texture_detail',
  'edge_halo_ringing',
  'motion_blur',
  'overlap_stitch_alignment',
  'lens_softness',
  'general_color_reference',
  'color_checker_reference',
  'skin_tone_reference',
  'layer_mask_composite',
  'local_adjustment_mask',
  'subpixel_detail_reconstruction',
]);

const privateRawEvidenceFeatureFamilySchema = z.enum([
  'color_science',
  'detail',
  'focus_stack',
  'hdr_merge',
  'layers_masks',
  'panorama_stitch',
  'super_resolution',
]);

export const privateRawEvidenceEntrySchema = z
  .object({
    artifactClass: privateRawEvidenceArtifactClassSchema,
    camera: cameraMetadataSchema,
    crop: cropRectangleSchema,
    evidenceId: z.string().regex(/^raw-evidence\.[a-z0-9.-]+\.v[0-9]+$/u),
    expectedUse: z
      .array(
        z.enum([
          'color_science',
          'deblur',
          'denoise',
          'detail',
          'focus_stack',
          'hdr_merge',
          'layers_masks',
          'panorama_stitch',
          'preview_export_parity',
          'super_resolution',
        ]),
      )
      .min(1),
    exposure: exposureMetadataSchema,
    featureFamily: privateRawEvidenceFeatureFamilySchema,
    fileSha256: sha256Schema.optional(),
    localRelativePath: z.string().trim().min(1).optional(),
    notes: z.string().trim().min(1),
    rights: rightsSchema,
    status: z.enum(['planned_private_capture', 'private_asset_available', 'retired']),
    trackingIssue: z.number().int().positive(),
  })
  .strict()
  .superRefine((entry, context) => {
    const expectedUseByFamily = {
      color_science: 'color_science',
      detail: 'detail',
      focus_stack: 'focus_stack',
      hdr_merge: 'hdr_merge',
      layers_masks: 'layers_masks',
      panorama_stitch: 'panorama_stitch',
      super_resolution: 'super_resolution',
    } as const;
    if (!entry.expectedUse.includes(expectedUseByFamily[entry.featureFamily])) {
      context.addIssue({
        code: 'custom',
        message: 'Private RAW evidence expectedUse must include its feature family.',
        path: ['expectedUse'],
      });
    }

    if (entry.status === 'private_asset_available' && entry.fileSha256 === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Available private RAW evidence requires fileSha256.',
        path: ['fileSha256'],
      });
    }

    if (entry.status === 'private_asset_available' && entry.localRelativePath === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Available private RAW evidence requires localRelativePath.',
        path: ['localRelativePath'],
      });
    }

    if (entry.rights.publicRepoAllowed) {
      context.addIssue({
        code: 'custom',
        message: 'Private RAW evidence ledger entries must not permit public repo redistribution.',
        path: ['rights', 'publicRepoAllowed'],
      });
    }
  });

export const privateRawEvidenceLedgerSchema = z
  .object({
    $schema: z.url(),
    entries: z.array(privateRawEvidenceEntrySchema).min(1),
    issue: z.literal(1149),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    validationMode: z.literal('schema_public_assets_private'),
  })
  .strict()
  .superRefine((ledger, context) => {
    const evidenceIds = ledger.entries.map((entry) => entry.evidenceId);
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Private RAW evidence IDs must be unique.',
        path: ['entries'],
      });
    }

    const requiredFamilies = [
      'color_science',
      'detail',
      'focus_stack',
      'hdr_merge',
      'layers_masks',
      'panorama_stitch',
      'super_resolution',
    ] as const;
    const featureFamilies = new Set(ledger.entries.map((entry) => entry.featureFamily));
    for (const featureFamily of requiredFamilies) {
      if (!featureFamilies.has(featureFamily)) {
        context.addIssue({
          code: 'custom',
          message: `Private RAW evidence ledger requires a ${featureFamily} slot.`,
          path: ['entries'],
        });
      }
    }
  });

export type PrivateRawEvidenceEntry = z.infer<typeof privateRawEvidenceEntrySchema>;
export type PrivateRawEvidenceLedger = z.infer<typeof privateRawEvidenceLedgerSchema>;

export function parsePrivateRawEvidenceLedger(value: unknown): PrivateRawEvidenceLedger {
  return privateRawEvidenceLedgerSchema.parse(value);
}
