import { z } from 'zod';

import { negativeLabBaseFogSampleRectSchema } from './negativeLabPresetCatalogSchemas';

const renderedRgbTupleSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);

export const negativeLabShadowPatchBlackPointStatusSchema = z.enum(['already_safe', 'blocked', 'suggested']);
export const negativeLabShadowPatchBlackPointRiskSchema = z.enum(['high', 'low', 'medium']);

export const negativeLabShadowPatchBlackPointSuggestionSchema = z
  .object({
    applicationRisk: negativeLabShadowPatchBlackPointRiskSchema,
    applyAllowed: z.boolean(),
    correctionMagnitude: z.number().min(0).max(0.95),
    currentBlackPoint: z.number().min(0).max(0.95),
    currentSampleP01MinChannel: z.number().min(0).max(1),
    currentSampleRgb: renderedRgbTupleSchema,
    endpointClamped: z.boolean(),
    projectedBlackPoint: z.number().min(0).max(0.95),
    projectedSampleP01MinChannel: z.number().min(0).max(1),
    projectedSampleRgb: renderedRgbTupleSchema,
    role: z.literal('shadow'),
    sampleRect: negativeLabBaseFogSampleRectSchema,
    status: negativeLabShadowPatchBlackPointStatusSchema,
    suggestedBlackPointDelta: z.number().min(0).max(0.95),
  })
  .strict();

export type NegativeLabShadowPatchBlackPointSuggestion = z.infer<
  typeof negativeLabShadowPatchBlackPointSuggestionSchema
>;
