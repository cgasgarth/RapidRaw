import { z } from 'zod';

export const focusStackFocusEvidenceSchema = z
  .object({
    algorithmId: z.literal('focus_hybrid_response_v1'),
    labelPolicyId: z.literal('focus_edge_aware_icm_v1'),
    noiseModelSource: z.literal('raw_estimate_or_robust_high_pass_mad'),
    policy: z
      .object({
        sigmas: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
        scaleWeights: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
        laplacianWeight: z.number().positive(),
        tenengradWeight: z.number().positive(),
        evidenceFloor: z.number().positive(),
        clipGuard: z.number().min(0).max(1),
        supportRadius: z.number().int().positive(),
        normalizationFormula: z.string().min(1),
      })
      .strict(),
    mapArtifact: z
      .object({
        formatId: z.literal('rapidraw_focus_map_v1'),
        version: z.literal(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        coordinateIdentity: z.string().min(1),
        endianness: z.literal('little'),
        channels: z.array(z.string().min(1)).length(12),
        contentHash: z.string().startsWith('blake3:'),
        bytesBase64: z.string().min(1),
        algorithmIdentity: z.string().min(1),
        winnerOverlayDataUrl: z.string().startsWith('data:image/png;base64,'),
        confidenceOverlayDataUrl: z.string().startsWith('data:image/png;base64,'),
        riskOverlayDataUrl: z.string().startsWith('data:image/png;base64,'),
      })
      .strict(),
    metrics: z
      .object({
        labeledPixelCount: z.number().int().nonnegative(),
        focusCoverageRatio: z.number().min(0).max(1),
        lowConfidenceRatio: z.number().min(0).max(1),
        invalidRatio: z.number().min(0).max(1),
        transitionRiskRatio: z.number().min(0).max(1),
        labelFragmentation: z.number().int().nonnegative(),
        changedPixelCount: z.number().int().nonnegative(),
        sourceContributions: z.array(
          z
            .object({
              sourceIndex: z.number().int().nonnegative(),
              pixelCount: z.number().int().nonnegative(),
              areaRatio: z.number().min(0).max(1),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export type FocusStackFocusEvidence = z.infer<typeof focusStackFocusEvidenceSchema>;
