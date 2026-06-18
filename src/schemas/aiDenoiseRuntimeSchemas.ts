import { z } from 'zod';

export const aiDenoisePixelSchema = z
  .object({
    b: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    r: z.number().min(0).max(1),
  })
  .strict();

export const aiDenoiseRuntimeSettingsSchema = z
  .object({
    chromaStrength: z.number().min(0).max(1),
    lumaStrength: z.number().min(0).max(1),
    modelId: z.literal('rawengine-local-denoise-adapter-v1'),
    modelVersion: z.literal('2026-06-17'),
    providerClass: z.literal('local_model'),
    tileRadius: z.literal(1),
  })
  .strict();

export const aiDenoiseImageBufferSchema = z
  .object({
    colorSpace: z.literal('scene_linear_rgb'),
    contentHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    height: z.number().int().positive(),
    pixels: z.array(aiDenoisePixelSchema).min(1),
    width: z.number().int().positive(),
  })
  .strict()
  .superRefine((buffer, context) => {
    if (buffer.pixels.length !== buffer.width * buffer.height) {
      context.addIssue({
        code: 'custom',
        message: 'Pixel count must match width * height.',
        path: ['pixels'],
      });
    }
  });

export const aiDenoiseRuntimeMetricsSchema = z
  .object({
    changedPixelCount: z.number().int().positive(),
    chromaVarianceAfter: z.number().nonnegative(),
    chromaVarianceBefore: z.number().positive(),
    edgeEnergyRatio: z.number().positive(),
    inputOutputMaxDelta: z.number().positive(),
    lumaVarianceAfter: z.number().nonnegative(),
    lumaVarianceBefore: z.number().positive(),
    meanAbsoluteDelta: z.number().positive(),
  })
  .strict()
  .superRefine((metrics, context) => {
    if (metrics.lumaVarianceAfter >= metrics.lumaVarianceBefore) {
      context.addIssue({
        code: 'custom',
        message: 'Denoise apply proof must reduce luma variance.',
        path: ['lumaVarianceAfter'],
      });
    }

    if (metrics.chromaVarianceAfter >= metrics.chromaVarianceBefore) {
      context.addIssue({
        code: 'custom',
        message: 'Denoise apply proof must reduce chroma variance.',
        path: ['chromaVarianceAfter'],
      });
    }
  });

export const aiDenoiseRuntimeProvenanceSchema = z
  .object({
    deterministic: z.literal(true),
    inputContentHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    outputContentHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    providerClass: z.literal('local_model'),
    sourceIssue: z.literal(1866),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (provenance.inputContentHash === provenance.outputContentHash) {
      context.addIssue({
        code: 'custom',
        message: 'Apply proof must change output content hash.',
        path: ['outputContentHash'],
      });
    }
  });

export const aiDenoiseRuntimeApplyProofSchema = z
  .object({
    applyStatus: z.literal('applied'),
    doesNotProve: z
      .array(z.enum(['app_server_route', 'gpu_parity', 'preview_export_parity', 'real_raw_quality']))
      .min(4),
    input: aiDenoiseImageBufferSchema,
    metrics: aiDenoiseRuntimeMetricsSchema,
    mutates: z.literal(true),
    orderedAfter: z.literal('demosaic'),
    orderedBefore: z.literal('scene_linear_deblur'),
    output: aiDenoiseImageBufferSchema,
    provenance: aiDenoiseRuntimeProvenanceSchema,
    runtimeStatus: z.literal('runtime_apply_capable'),
    schemaVersion: z.literal(1),
    settings: aiDenoiseRuntimeSettingsSchema,
    stage: z.literal('scene_linear_denoise'),
    warnings: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.input.width !== proof.output.width || proof.input.height !== proof.output.height) {
      context.addIssue({
        code: 'custom',
        message: 'Denoise output dimensions must match input dimensions.',
        path: ['output'],
      });
    }

    if (!proof.doesNotProve.includes('real_raw_quality')) {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic denoise proof must not claim real RAW quality.',
        path: ['doesNotProve'],
      });
    }
  });

export type AiDenoiseImageBuffer = z.infer<typeof aiDenoiseImageBufferSchema>;
export type AiDenoisePixel = z.infer<typeof aiDenoisePixelSchema>;
export type AiDenoiseRuntimeApplyProof = z.infer<typeof aiDenoiseRuntimeApplyProofSchema>;
export type AiDenoiseRuntimeSettings = z.infer<typeof aiDenoiseRuntimeSettingsSchema>;
