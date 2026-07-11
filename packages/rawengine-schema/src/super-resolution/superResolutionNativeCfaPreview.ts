import { z } from 'zod';

const blake3HashSchema = z.string().regex(/^blake3:[a-f0-9]{64}$/u);
const pngArtifactSchema = z
  .object({
    contentHash: blake3HashSchema,
    dataUrl: z.string().startsWith('data:image/png;base64,'),
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict();

export const superResolutionNativeCfaPreviewV1Schema = z
  .object({
    algorithmId: z.literal('positive_adaptive_cfa_kernel_huber2_v1'),
    capability: z.literal('native_burst_cfa_preview'),
    colorAlgorithmId: z.literal('support_aware_post_fusion_rgb_v1'),
    decision: z.literal('quality_gate_pending'),
    fallbackRatio: z.number().min(0).max(1),
    greenPhaseGain: z
      .object({
        accepted: z.boolean(),
        gain: z.number().positive(),
        residual: z.number().nonnegative(),
        sampleCount: z.number().int().nonnegative(),
      })
      .strict(),
    height: z.number().int().positive(),
    planeArtifacts: z
      .array(
        z
          .object({
            averageOutlierRatio: z.number().min(0).max(1),
            averageVariance: z.number().nonnegative(),
            class: z.enum(['R', 'G1', 'G2', 'B']),
            contributingSourceMask: z.number().int().min(0).max(255),
            coverageRatio: z.number().min(0).max(1),
            residual: pngArtifactSchema,
            support: pngArtifactSchema,
            weakSupportRatio: z.number().min(0).max(1),
          })
          .strict(),
      )
      .length(4),
    preview: pngArtifactSchema,
    referenceBaseline: pngArtifactSchema,
    registrationPlanHash: blake3HashSchema,
    width: z.number().int().positive(),
  })
  .strict();

export type SuperResolutionNativeCfaPreviewV1 = z.infer<typeof superResolutionNativeCfaPreviewV1Schema>;
