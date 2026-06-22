import { z } from 'zod';

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  detailDenoiseControlsV1Schema,
} from '../../packages/rawengine-schema/src';
import { waveletDetailRecipeSchema } from '../schemas/waveletDetailSchemas';

const normalizedCropPixelSchema = z.number().min(0).max(1);

export const detailOutputComparisonRecipeV1Schema = z
  .object({
    denoise: detailDenoiseControlsV1Schema,
    label: z.literal('Denoise + detail 100% review'),
    recipeId: z.literal('detail.output.denoise-detail-100.v1'),
    stages: z.array(z.enum(['scene_linear_denoise', 'capture_sharpen', 'wavelet_luma_detail'])).length(3),
    waveletDetail: waveletDetailRecipeSchema,
  })
  .strict();

export const detailOutputComparisonCommandV1Schema = z
  .object({
    actor: z
      .object({
        id: z.string().trim().min(1),
        kind: z.enum(['agent', 'ui']),
        sessionId: z.string().trim().min(1).optional(),
      })
      .strict(),
    approval: z
      .object({
        approvalClass: z.literal(ApprovalClass.EditApply),
        reason: z.string().trim().min(1),
        state: z.literal('approved'),
      })
      .strict(),
    commandId: z.string().trim().min(1),
    commandType: z.literal('detailOutput.applyComparisonRecipe'),
    correlationId: z.string().trim().min(1),
    dryRun: z.literal(false),
    expectedGraphRevision: z.string().trim().min(1),
    parameters: z
      .object({
        crop: z
          .object({
            height: z.number().int().positive(),
            width: z.number().int().positive(),
            x: z.number().int().nonnegative(),
            y: z.number().int().nonnegative(),
            zoomPercent: z.literal(100),
          })
          .strict(),
        recipe: detailOutputComparisonRecipeV1Schema,
      })
      .strict(),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    target: z
      .object({
        imagePath: z.string().trim().min(1),
        kind: z.literal('image'),
      })
      .strict(),
  })
  .strict();

export const detailOutputComparisonCommandApplyInputV1Schema = z
  .object({
    command: detailOutputComparisonCommandV1Schema,
    currentBaselineCrop: z.array(normalizedCropPixelSchema).min(1),
    originalCrop: z.array(normalizedCropPixelSchema).min(1),
  })
  .strict()
  .superRefine((input, context) => {
    const pixelCount = input.command.parameters.crop.width * input.command.parameters.crop.height;
    if (input.currentBaselineCrop.length !== pixelCount) {
      context.addIssue({
        code: 'custom',
        message: 'currentBaselineCrop must match the command crop dimensions.',
        path: ['currentBaselineCrop'],
      });
    }
    if (input.originalCrop.length !== pixelCount) {
      context.addIssue({
        code: 'custom',
        message: 'originalCrop must match the command crop dimensions.',
        path: ['originalCrop'],
      });
    }
  });

export const detailOutputComparisonCommandApplyResultV1Schema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    changedPixelRatio: z.number().min(0).max(1),
    commandId: z.string().trim().min(1),
    disabledExportHash: z.string().trim().min(1),
    enabledExportHash: z.string().trim().min(1),
    originalHash: z.string().trim().min(1),
    previewHash: z.string().trim().min(1),
    recipePreviewCrop: z.array(normalizedCropPixelSchema).min(1),
    sourceGraphRevision: z.string().trim().min(1),
    warnings: z.array(z.enum(['crop_bounds_ok', 'halo_risk_review', 'oversmoothing_review'])).min(3),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.enabledExportHash === result.disabledExportHash) {
      context.addIssue({
        code: 'custom',
        message: 'enabled export must differ from disabled export.',
        path: ['enabledExportHash'],
      });
    }
    if (result.previewHash !== result.enabledExportHash) {
      context.addIssue({
        code: 'custom',
        message: 'preview and enabled export must share the comparison recipe output hash.',
        path: ['previewHash'],
      });
    }
  });

export type DetailOutputComparisonCommandV1 = z.infer<typeof detailOutputComparisonCommandV1Schema>;
export type DetailOutputComparisonCommandApplyResultV1 = z.infer<
  typeof detailOutputComparisonCommandApplyResultV1Schema
>;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const hashPixels = (pixels: ReadonlyArray<number>): string => {
  let hash = 0x811c9dc5;
  for (const pixel of pixels) {
    hash ^= Math.round(clamp01(pixel) * 255);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const blur3x3 = (pixels: ReadonlyArray<number>, width: number, height: number): Array<number> => {
  const output: Array<number> = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
          sum += pixels[sy * width + sx] ?? 0;
          count += 1;
        }
      }
      output.push(sum / count);
    }
  }
  return output;
};

export const applyDetailOutputComparisonCommand = (value: unknown): DetailOutputComparisonCommandApplyResultV1 => {
  const input = detailOutputComparisonCommandApplyInputV1Schema.parse(value);
  const { height, width } = input.command.parameters.crop;
  const denoised = blur3x3(input.currentBaselineCrop, width, height);
  const fineScale = input.command.parameters.recipe.waveletDetail.fine;
  const mediumScale = input.command.parameters.recipe.waveletDetail.medium;
  const detailGain =
    (fineScale.enabled ? fineScale.amount : 0) / 100 + (mediumScale.enabled ? mediumScale.amount : 0) / 200;
  const lumaPreserve = 1 - input.command.parameters.recipe.denoise.lumaStrength * 0.62;
  const detailBase = blur3x3(denoised, width, height);

  const recipePreviewCrop = input.currentBaselineCrop.map((pixel, index) => {
    const smooth = denoised[index] ?? pixel;
    const detail = pixel - smooth;
    const wavelet = smooth - (detailBase[index] ?? smooth);
    return Number(clamp01(smooth + detail * lumaPreserve + wavelet * detailGain).toFixed(6));
  });
  const changedPixels = recipePreviewCrop.filter(
    (pixel, index) => Math.abs(pixel - (input.currentBaselineCrop[index] ?? 0)) > 1 / 255,
  ).length;

  return detailOutputComparisonCommandApplyResultV1Schema.parse({
    appliedGraphRevision: `${input.command.expectedGraphRevision}_${input.command.commandId}`,
    changedPixelRatio: Number((changedPixels / recipePreviewCrop.length).toFixed(6)),
    commandId: input.command.commandId,
    disabledExportHash: hashPixels(input.currentBaselineCrop),
    enabledExportHash: hashPixels(recipePreviewCrop),
    originalHash: hashPixels(input.originalCrop),
    previewHash: hashPixels(recipePreviewCrop),
    recipePreviewCrop,
    sourceGraphRevision: input.command.expectedGraphRevision,
    warnings: ['crop_bounds_ok', 'halo_risk_review', 'oversmoothing_review'],
  });
};
