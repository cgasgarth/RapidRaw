import { z } from 'zod';

const normalizedScalarSchema = z.number().min(0).max(1);

export const captureSharpeningStageSchema = z.literal('post_demosaic_pre_global');

export const captureSharpeningPresetSchema = z
  .object({
    amount: normalizedScalarSchema,
    applyToNonRaw: z.boolean(),
    colorNoiseReduction: normalizedScalarSchema,
    detail: normalizedScalarSchema,
    edgeMasking: normalizedScalarSchema,
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    radiusPx: z.number().min(0.5).max(3),
    schemaVersion: z.literal(1),
    sourceClass: z.enum(['raw_low_iso', 'raw_high_iso', 'non_raw_opt_in']),
    stage: captureSharpeningStageSchema,
  })
  .strict()
  .superRefine((preset, context) => {
    if (preset.sourceClass === 'raw_high_iso' && preset.amount > 0.55 && preset.edgeMasking < 0.35) {
      context.addIssue({
        code: 'custom',
        message: 'High ISO capture sharpening requires conservative amount or stronger edge masking.',
        path: ['edgeMasking'],
      });
    }

    if (preset.sourceClass === 'non_raw_opt_in' && !preset.applyToNonRaw) {
      context.addIssue({
        code: 'custom',
        message: 'Non-RAW capture sharpening presets must explicitly opt in.',
        path: ['applyToNonRaw'],
      });
    }
  });

export type CaptureSharpeningPreset = z.infer<typeof captureSharpeningPresetSchema>;

export function estimateCaptureSharpeningKernelDiameter(preset: CaptureSharpeningPreset): number {
  return Math.ceil(preset.radiusPx) * 2 + 1;
}

export function parseCaptureSharpeningPreset(value: unknown): CaptureSharpeningPreset {
  return captureSharpeningPresetSchema.parse(value);
}
