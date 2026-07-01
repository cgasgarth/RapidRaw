import { z } from 'zod';

import { negativeLabBaseFogSampleRectSchema } from './negativeLabPresetCatalogSchemas';

export const NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION = 1;

export const negativeLabPatchSamplerCorrectionRoleSchema = z.enum([
  'base_fog',
  'highlight_exposure',
  'neutral_rgb_balance',
  'shadow_black_point',
]);

export const negativeLabPatchSamplerCorrectionSchema = z
  .object({
    accepted: z.literal(true),
    appliedAt: z.string().trim().min(1),
    correctionId: z.string().trim().min(1),
    frameId: z.string().trim().min(1),
    role: negativeLabPatchSamplerCorrectionRoleSchema,
    sampleRect: negativeLabBaseFogSampleRectSchema.nullable(),
    sourceCommand: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    values: z.record(z.string(), z.unknown()),
  })
  .strict();

export const negativeLabPatchSamplerCorrectionPayloadSchema = z
  .object({
    corrections: z.array(negativeLabPatchSamplerCorrectionSchema),
    schemaVersion: z.literal(NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION),
  })
  .strict();

export type NegativeLabPatchSamplerCorrectionRole = z.infer<typeof negativeLabPatchSamplerCorrectionRoleSchema>;
export type NegativeLabPatchSamplerCorrection = z.infer<typeof negativeLabPatchSamplerCorrectionSchema>;
export type NegativeLabPatchSamplerCorrectionPayload = z.infer<typeof negativeLabPatchSamplerCorrectionPayloadSchema>;

export const parseNegativeLabPatchSamplerCorrectionPayload = (
  value: unknown,
): NegativeLabPatchSamplerCorrectionPayload => negativeLabPatchSamplerCorrectionPayloadSchema.parse(value);
