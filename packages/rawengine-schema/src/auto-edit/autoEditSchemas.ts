import { z } from 'zod';

export const AUTO_EDIT_CONTRACT_V1 = 'rapidraw.auto_edit.v1' as const;

export const autoEditGroupSchema = z.enum([
  'technical_white_balance',
  'light',
  'color',
  'atmosphere',
  'detail',
  'geometry',
]);

export const autoRecommendationStateSchema = z.enum([
  'recommended',
  'disabled_low_confidence',
  'not_applicable',
  'unsupported_source',
  'blocked_by_current_process',
  'analysis_failed',
]);

export const autoEditAnalysisIdentityV1Schema = z
  .object({
    sourceRevision: z.string().startsWith('source-revision-v1:'),
    sourceIdentity: z.string().min(1),
    decodePlanFingerprint: z.string().regex(/^u64:[0-9a-f]{16}$/u),
    cameraProfileFingerprint: z
      .string()
      .regex(/^u64:[0-9a-f]{16}$/u)
      .nullable(),
    whiteBalanceFingerprint: z
      .string()
      .regex(/^u64:[0-9a-f]{16}$/u)
      .nullable(),
    geometryFingerprint: z.string().regex(/^u64:[0-9a-f]{16}$/u),
    analysisDomain: z.enum(['raw_scene_linear', 'rendered_scene_linear_approximation']),
    analysisResolution: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    implementationVersion: z.literal(1),
  })
  .strict();

const sceneEvPercentilesV1Schema = z
  .object({
    p01: z.number().finite(),
    p05: z.number().finite(),
    p25: z.number().finite(),
    p50: z.number().finite(),
    p75: z.number().finite(),
    p95: z.number().finite(),
    p99: z.number().finite(),
  })
  .strict();

export const autoEditEvidenceV1Schema = z
  .object({
    sceneEvPercentiles: sceneEvPercentilesV1Schema,
    neutralCandidateStats: z
      .object({
        acceptedSamples: z.number().int().nonnegative(),
        rejectedSamples: z.number().int().nonnegative(),
        medianAp1: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
        chromaSpread: z.number().finite().nonnegative(),
        spatialTileCoverage: z.number().min(0).max(1),
      })
      .strict(),
    clippingStats: z
      .object({
        sensorClippedFraction: z.number().min(0).max(1).nullable(),
        reconstructedFraction: z.number().min(0).max(1).nullable(),
        sceneOverrangeFraction: z.number().min(0).max(1),
        brightValidFraction: z.number().min(0).max(1),
        specularCandidateFraction: z.number().min(0).max(1),
      })
      .strict(),
    chromaStats: z
      .object({
        p50: z.number().finite().nonnegative(),
        p90: z.number().finite().nonnegative(),
        lowChromaFraction: z.number().min(0).max(1),
      })
      .strict(),
    spatialIlluminationStats: z
      .object({
        centerEv: z.number().finite(),
        edgeEv: z.number().finite(),
        centerEdgeDeltaEv: z.number().finite(),
        occupiedTiles: z.number().int().nonnegative(),
      })
      .strict(),
    localContrast: z.number().finite().nonnegative(),
    dynamicRangeEv: z.number().finite().nonnegative(),
    validSamples: z.number().int().positive(),
    rejectedNonFiniteSamples: z.number().int().nonnegative(),
    warningCodes: z.array(z.string().min(1)),
  })
  .strict();

export const autoEditAnalysisV1Schema = z
  .object({
    contract: z.literal(AUTO_EDIT_CONTRACT_V1),
    identity: autoEditAnalysisIdentityV1Schema,
    evidence: autoEditEvidenceV1Schema,
    elapsedMicros: z.number().int().nonnegative(),
  })
  .strict();

export const autoRecommendationV1Schema = z
  .object({
    group: autoEditGroupSchema,
    target: z.string().min(1),
    proposedParameters: z.unknown(),
    confidence: z.number().min(0).max(1),
    evidenceCodes: z.array(z.string().min(1)),
    expectedEffect: z.enum([
      'technical_correction',
      'scene_light',
      'conservative_color',
      'atmospheric_correction',
      'detail_recovery',
      'geometry_correction',
      'none',
    ]),
    safeToBatch: z.boolean(),
    state: autoRecommendationStateSchema,
  })
  .strict();

export const autoEditProposalV1Schema = z
  .object({
    contract: z.literal(AUTO_EDIT_CONTRACT_V1),
    analysisIdentity: autoEditAnalysisIdentityV1Schema,
    proposalId: z.string().startsWith('blake3:'),
    imageSessionId: z.string().min(1),
    baseGraphRevision: z.string().min(1),
    baseGraphFingerprint: z.string().startsWith('blake3:'),
    recommendations: z.array(autoRecommendationV1Schema),
    defaultEnabledGroups: z.array(autoEditGroupSchema),
    impact: z.number().min(0).max(1),
    implementationVersion: z.literal(1),
  })
  .strict();

export const autoEditApplicationReceiptV1Schema = z
  .object({
    contract: z.literal(AUTO_EDIT_CONTRACT_V1),
    proposalId: z.string().startsWith('blake3:'),
    sourceRevision: z.string().startsWith('source-revision-v1:'),
    baseGraphRevision: z.string().min(1),
    resultingGraphRevision: z.string().min(1),
    beforeGraphFingerprint: z.string().startsWith('blake3:'),
    afterGraphFingerprint: z.string().startsWith('blake3:'),
    historyTransactionId: z.string().startsWith('blake3:'),
    appliedGroups: z.array(autoEditGroupSchema),
    skippedGroups: z.array(autoEditGroupSchema),
    parameterDiffs: z.array(
      z
        .object({
          key: z.string().min(1),
          before: z.unknown(),
          after: z.unknown(),
          group: autoEditGroupSchema,
        })
        .strict(),
    ),
    impact: z.number().min(0).max(1),
    implementationVersion: z.literal(1),
  })
  .strict();

export const autoEditPreviewV1Schema = z
  .object({
    proposalId: z.string().startsWith('blake3:'),
    previewIdentity: z.string().startsWith('blake3:'),
    sourceRevision: z.string().startsWith('source-revision-v1:'),
    graphRevision: z.string().min(1),
    adjustments: z.record(z.string(), z.unknown()),
    selectedGroups: z.array(autoEditGroupSchema),
    impact: z.number().min(0).max(1),
  })
  .strict();

export const appliedAutoEditV1Schema = z
  .object({
    adjustments: z.record(z.string(), z.unknown()),
    receipt: autoEditApplicationReceiptV1Schema,
  })
  .strict();

export type AutoEditGroup = z.infer<typeof autoEditGroupSchema>;
export type AutoEditProposalV1 = z.infer<typeof autoEditProposalV1Schema>;
export type AutoEditPreviewV1 = z.infer<typeof autoEditPreviewV1Schema>;
export type AppliedAutoEditV1 = z.infer<typeof appliedAutoEditV1Schema>;
