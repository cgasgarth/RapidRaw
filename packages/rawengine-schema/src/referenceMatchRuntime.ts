import { z } from 'zod';

const fingerprintSchema = z.string().regex(/^fnv1a64:[0-9a-f]{16}$/);

export const referenceMatchModeV1Schema = z.enum(['normalize', 'match-look']);
export const referenceMatchGroupV1Schema = z.enum(['tone', 'color', 'presence']);

export const referenceSourceV1Schema = z
  .object({
    geometryFingerprint: fingerprintSchema,
    graphFingerprint: fingerprintSchema,
    proofFingerprint: fingerprintSchema,
    role: z.enum(['creative', 'technical']),
    sourceFingerprint: fingerprintSchema,
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
    greenMean: z.number().min(0).max(1),
    lumaMean: z.number().min(0).max(1),
    lumaSpread: z.number().min(0).max(0.5),
    redMean: z.number().min(0).max(1),
    sampleCount: z.number().int().positive(),
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

export const matchLookProposalV1Schema = z
  .object({
    confidence: z.number().min(0).max(1),
    diffs: z.array(matchLookNodeDiffV1Schema).min(1).max(6),
    effectiveReferences: z
      .array(z.object({ sourceFingerprint: fingerprintSchema, weight: z.number().positive().max(10) }).strict())
      .min(1)
      .max(8),
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
    destination: z.literal('global-adjustments'),
    enabledGroups: z.array(referenceMatchGroupV1Schema).min(1),
    historyEntriesAdded: z.literal(1),
    impact: z.number().min(0).max(100),
    proposalFingerprint: fingerprintSchema,
    resultingGraphFingerprint: fingerprintSchema,
    schemaVersion: z.literal(1),
    targetAnalysisFingerprint: fingerprintSchema,
  })
  .strict();

export type ReferenceSourceSetV1 = z.infer<typeof referenceSourceSetV1Schema>;
export type MatchLookProposalV1 = z.infer<typeof matchLookProposalV1Schema>;
export type MatchLookApplicationReceiptV1 = z.infer<typeof matchLookApplicationReceiptV1Schema>;
