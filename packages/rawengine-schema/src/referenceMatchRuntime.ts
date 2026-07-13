import { z } from 'zod';

const fingerprintSchema = z.string().regex(/^fnv1a64:[0-9a-f]{16}$/);
const sourceRevisionSchema = z.string().regex(/^source-revision-v1:[0-9a-f]{64}$/);

export const referencePhysicalSourceIdentityV1Schema = z
  .object({
    available: z.boolean(),
    sourceRevision: sourceRevisionSchema.nullable(),
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.available !== (identity.sourceRevision !== null)) {
      context.addIssue({ code: 'custom', message: 'Available sources require a source revision.' });
    }
  });

export const referenceMatchModeV1Schema = z.enum(['normalize', 'match-look']);
export const referenceMatchGroupV1Schema = z.enum(['tone', 'color', 'presence']);

export const referenceSourceV1Schema = z
  .object({
    geometryFingerprint: fingerprintSchema,
    graphFingerprint: fingerprintSchema,
    proofFingerprint: fingerprintSchema,
    role: z.enum(['creative', 'technical']),
    sourceFingerprint: fingerprintSchema,
    sourceRevision: sourceRevisionSchema,
    viewFingerprint: fingerprintSchema,
    weight: z.number().positive().max(10),
  })
  .strict();

export const referenceSourceSetV1Schema = z
  .object({
    normalization: z.literal('sum-to-one'),
    references: z.array(referenceSourceV1Schema).min(1).max(8),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    const identities = value.references.map((reference) => reference.sourceFingerprint);
    if (new Set(identities).size !== identities.length) {
      context.addIssue({ code: 'custom', message: 'Reference sources must be unique.', path: ['references'] });
    }
  });

export const referenceDistributionSummaryV1Schema = z
  .object({
    analysisBasis: z.literal('color-managed-editor-preview'),
    blueMean: z.number().min(0).max(1),
    clippedFraction: z.number().min(0).max(1),
    greenMean: z.number().min(0).max(1),
    lumaMean: z.number().min(0).max(1),
    lumaSpread: z.number().min(0).max(0.5),
    redMean: z.number().min(0).max(1),
    sampleCount: z.number().int().positive(),
    spatialTiles: z
      .array(
        z
          .object({
            blueMean: z.number().min(0).max(1),
            clippedFraction: z.number().min(0).max(1),
            greenMean: z.number().min(0).max(1),
            lumaMean: z.number().min(0).max(1),
            lumaSpread: z.number().min(0).max(0.5),
            redMean: z.number().min(0).max(1),
            sampleCount: z.number().int().nonnegative(),
            x: z.number().int().nonnegative(),
            y: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

export const matchLookNodeDiffV1Schema = z
  .object({
    current: z.number().finite(),
    group: referenceMatchGroupV1Schema,
    key: z.enum(['exposure', 'contrast', 'creativeTemperature', 'creativeTint', 'saturation', 'vibrance']),
    proposed: z.number().finite(),
  })
  .strict();

const effectiveReferenceSetV1Schema = z
  .array(
    z
      .object({
        role: z.enum(['creative', 'technical']),
        sourceFingerprint: fingerprintSchema,
        weight: z.number().positive().max(1),
      })
      .strict(),
  )
  .min(1)
  .max(8)
  .refine((references) => Math.abs(references.reduce((sum, reference) => sum + reference.weight, 0) - 1) < 1e-6, {
    message: 'Effective reference weights must be normalized.',
  });

export const matchLookProposalV1Schema = z
  .object({
    confidence: z.number().min(0).max(1),
    diffs: z.array(matchLookNodeDiffV1Schema).min(1).max(6),
    effectiveReferences: effectiveReferenceSetV1Schema,
    mode: referenceMatchModeV1Schema,
    processVersion: z.literal('rapidraw-reference-match-v1'),
    proposalFingerprint: fingerprintSchema,
    residualAfter: z.number().nonnegative(),
    residualBefore: z.number().nonnegative(),
    schemaVersion: z.literal(1),
    targetAnalysisFingerprint: fingerprintSchema,
    warnings: z.array(z.string().min(1)).max(16),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.residualAfter > proposal.residualBefore) {
      context.addIssue({ code: 'custom', message: 'A proposal must not increase its declared residual.' });
    }
    if (proposal.mode === 'normalize' && proposal.diffs.some((diff) => diff.group !== 'tone')) {
      context.addIssue({
        code: 'custom',
        message: 'Normalize may only propose technical tone nodes.',
        path: ['diffs'],
      });
    }
  });

export const matchLookApplicationReceiptV1Schema = z
  .object({
    appliedAt: z.string().datetime(),
    baseGraphFingerprint: fingerprintSchema,
    destination: z.enum(['global-adjustments', 'adjustment-layer']),
    effectiveReferences: effectiveReferenceSetV1Schema,
    enabledGroups: z.array(referenceMatchGroupV1Schema).min(1),
    historyEntriesAdded: z.literal(1),
    impact: z.number().min(0).max(100),
    layerId: z.string().trim().min(1).optional(),
    proposalFingerprint: fingerprintSchema,
    resultingGraphFingerprint: fingerprintSchema,
    schemaVersion: z.literal(1),
    targetAnalysisFingerprint: fingerprintSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.destination === 'adjustment-layer' && receipt.layerId === undefined) {
      context.addIssue({ code: 'custom', message: 'Layer destination requires a layer ID.', path: ['layerId'] });
    }
    if (receipt.destination === 'global-adjustments' && receipt.layerId !== undefined) {
      context.addIssue({ code: 'custom', message: 'Global destination cannot declare a layer ID.', path: ['layerId'] });
    }
  });

export type ReferenceSourceSetV1 = z.infer<typeof referenceSourceSetV1Schema>;
export type MatchLookProposalV1 = z.infer<typeof matchLookProposalV1Schema>;
export type MatchLookApplicationReceiptV1 = z.infer<typeof matchLookApplicationReceiptV1Schema>;
