import { z } from 'zod';

import { type MaskAlphaArtifact, maskAlphaArtifactSchema } from './maskComposeCommandRuntime.js';

const normalizedPixelSchema = z.number().min(0).max(1);
const maskComposeLayerAdjustmentSchema = z
  .object({
    exposureEv: z.number().min(-5).max(5),
    layerId: z.string().trim().min(1),
    layerName: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
  })
  .strict();

export const maskComposeLayerApplicationRequestSchema = z
  .object({
    adjustment: maskComposeLayerAdjustmentSchema,
    composedMask: maskAlphaArtifactSchema,
    compositionMode: z.enum(['add', 'subtract', 'intersect']),
    sourceMaskIds: z.array(z.string().trim().min(1)).min(2),
    sourcePixels: z.array(normalizedPixelSchema).min(1),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sourcePixels.length !== request.composedMask.alpha.length) {
      context.addIssue({
        code: 'custom',
        message: 'Composed mask layer application requires one mask alpha per source pixel.',
        path: ['sourcePixels'],
      });
    }
  });

export const maskComposeLayerSidecarRecordSchema = z
  .object({
    composedMask: z
      .object({
        contentHash: z.string().trim().min(1),
        coordinateSpace: z.literal('source_asset_pixels'),
        height: z.number().int().positive(),
        maskId: z.string().trim().min(1),
        mode: z.enum(['add', 'subtract', 'intersect']),
        sourceMaskIds: z.array(z.string().trim().min(1)).min(2),
        width: z.number().int().positive(),
      })
      .strict(),
    layer: maskComposeLayerAdjustmentSchema,
    noOverwritePolicy: z.literal('never_overwrite_original'),
    outputContentHash: z.string().trim().min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const maskComposeLayerApplicationResultSchema = z
  .object({
    changedPixelCount: z.number().int().nonnegative(),
    maxDelta: z.number().min(0).max(1),
    outputContentHash: z.string().trim().min(1),
    outputPixels: z.array(normalizedPixelSchema).min(1),
    overlayAlpha: z.array(normalizedPixelSchema).min(1),
    sidecarRecord: maskComposeLayerSidecarRecordSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.outputPixels.length !== result.overlayAlpha.length) {
      context.addIssue({
        code: 'custom',
        message: 'Composed mask output pixels and overlay alpha must have matching lengths.',
        path: ['overlayAlpha'],
      });
    }
  });

export type MaskComposeLayerApplicationRequest = z.infer<typeof maskComposeLayerApplicationRequestSchema>;
export type MaskComposeLayerApplicationResult = z.infer<typeof maskComposeLayerApplicationResultSchema>;
export type MaskComposeLayerSidecarRecord = z.infer<typeof maskComposeLayerSidecarRecordSchema>;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const quantizeByte = (value: number): number => Math.round(clamp01(value) * 255);

const stablePixelHash = (pixels: ReadonlyArray<number>): string => {
  let hash = 0x811c9dc5;
  for (const pixel of pixels) {
    hash ^= quantizeByte(pixel);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const resolvedContentHash = (mask: MaskAlphaArtifact): string => mask.contentHash ?? stablePixelHash(mask.alpha);

export const applyComposedMaskToLayerPixels = (value: unknown): MaskComposeLayerApplicationResult => {
  const request = maskComposeLayerApplicationRequestSchema.parse(value);
  const exposureScale = request.adjustment.exposureEv / 4;
  let changedPixelCount = 0;
  let maxDelta = 0;

  const outputPixels = request.sourcePixels.map((pixel, index) => {
    const weight = clamp01((request.composedMask.alpha[index] ?? 0) * request.adjustment.opacity);
    const outputPixel = clamp01(pixel + exposureScale * weight);
    const delta = Math.abs(outputPixel - pixel);
    if (delta > 0.000001) changedPixelCount += 1;
    maxDelta = Math.max(maxDelta, delta);
    return Number(outputPixel.toFixed(6));
  });
  const outputContentHash = stablePixelHash(outputPixels);

  return maskComposeLayerApplicationResultSchema.parse({
    changedPixelCount,
    maxDelta: Number(maxDelta.toFixed(6)),
    outputContentHash,
    outputPixels,
    overlayAlpha: request.composedMask.alpha.map((alpha) =>
      Number(clamp01(alpha * request.adjustment.opacity).toFixed(6)),
    ),
    sidecarRecord: {
      composedMask: {
        contentHash: resolvedContentHash(request.composedMask),
        coordinateSpace: 'source_asset_pixels',
        height: request.composedMask.height,
        maskId: request.composedMask.maskId,
        mode: request.compositionMode,
        sourceMaskIds: request.sourceMaskIds,
        width: request.composedMask.width,
      },
      layer: request.adjustment,
      noOverwritePolicy: 'never_overwrite_original',
      outputContentHash,
      schemaVersion: 1,
    },
  });
};
