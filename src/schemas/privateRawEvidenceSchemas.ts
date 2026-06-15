import { z } from 'zod';

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
    rawFormat: z.enum(['arw', 'cr2', 'cr3', 'dng', 'nef', 'raf', 'rw2', 'orf', 'pef', 'srw']),
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
  'high_iso_chroma_noise',
  'high_iso_luma_noise',
  'fine_texture_detail',
  'edge_halo_ringing',
  'motion_blur',
  'lens_softness',
  'color_checker_reference',
  'skin_tone_reference',
]);

export const privateRawEvidenceEntrySchema = z
  .object({
    artifactClass: privateRawEvidenceArtifactClassSchema,
    camera: cameraMetadataSchema,
    crop: cropRectangleSchema,
    evidenceId: z.string().regex(/^raw-evidence\.[a-z0-9.-]+\.v[0-9]+$/u),
    expectedUse: z.array(z.enum(['denoise', 'deblur', 'detail', 'color_science', 'preview_export_parity'])).min(1),
    exposure: exposureMetadataSchema,
    fileSha256: sha256Schema.optional(),
    localRelativePath: z.string().trim().min(1).optional(),
    notes: z.string().trim().min(1),
    rights: rightsSchema,
    status: z.enum(['planned_private_capture', 'private_asset_available', 'retired']),
  })
  .strict()
  .superRefine((entry, context) => {
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
  });

export type PrivateRawEvidenceEntry = z.infer<typeof privateRawEvidenceEntrySchema>;
export type PrivateRawEvidenceLedger = z.infer<typeof privateRawEvidenceLedgerSchema>;

export function parsePrivateRawEvidenceLedger(value: unknown): PrivateRawEvidenceLedger {
  return privateRawEvidenceLedgerSchema.parse(value);
}
