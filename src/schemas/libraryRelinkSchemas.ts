import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const libraryRelinkIdentitySchema = z
  .object({
    byteLength: z.number().int().nonnegative().nullable(),
    cameraMake: z.string().trim().min(1).nullable().optional(),
    cameraModel: z.string().trim().min(1).nullable().optional(),
    captureTimestamp: z.iso.datetime().nullable().optional(),
    contentHash: sha256Schema.nullable().optional(),
    lensModel: z.string().trim().min(1).nullable().optional(),
    path: z.string().trim().min(1),
  })
  .strict();

export const libraryRelinkEvidenceKindSchema = z.enum([
  'content_hash',
  'byte_length',
  'capture_timestamp',
  'camera_make',
  'camera_model',
  'lens_model',
  'filename',
]);

export const libraryRelinkEvidenceSchema = z
  .object({
    kind: libraryRelinkEvidenceKindSchema,
    status: z.enum(['match', 'mismatch', 'missing']),
    weight: z.number().int(),
  })
  .strict();

export const libraryRelinkCandidateDecisionSchema = z.enum(['verified', 'possible', 'rejected']);

export const libraryRelinkCandidateResultSchema = z
  .object({
    candidatePath: z.string().trim().min(1),
    decision: libraryRelinkCandidateDecisionSchema,
    evidence: z.array(libraryRelinkEvidenceSchema).min(1),
    score: z.number().int(),
  })
  .strict();

export const libraryRelinkPlanSchema = z
  .object({
    candidates: z.array(libraryRelinkCandidateResultSchema),
    selectedCandidatePath: z.string().trim().min(1).nullable(),
    status: z.enum(['matched', 'ambiguous', 'rejected']),
  })
  .strict();

export type LibraryRelinkCandidateDecision = z.infer<typeof libraryRelinkCandidateDecisionSchema>;
export type LibraryRelinkCandidateResult = z.infer<typeof libraryRelinkCandidateResultSchema>;
export type LibraryRelinkEvidence = z.infer<typeof libraryRelinkEvidenceSchema>;
export type LibraryRelinkEvidenceKind = z.infer<typeof libraryRelinkEvidenceKindSchema>;
export type LibraryRelinkIdentity = z.infer<typeof libraryRelinkIdentitySchema>;
export type LibraryRelinkPlan = z.infer<typeof libraryRelinkPlanSchema>;
