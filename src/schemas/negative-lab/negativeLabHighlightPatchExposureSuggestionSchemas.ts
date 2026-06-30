import { z } from 'zod';

import { negativeLabBaseFogSampleRectSchema } from './negativeLabPresetCatalogSchemas';

const renderedRgbTupleSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);

export const negativeLabHighlightPatchExposureStatusSchema = z.enum(['already_safe', 'blocked', 'suggested']);
export const negativeLabHighlightPatchExposureRiskSchema = z.enum(['high', 'low', 'medium']);

export const negativeLabHighlightPatchExposureSuggestionSchema = z
  .object({
    applicationRisk: negativeLabHighlightPatchExposureRiskSchema,
    applyAllowed: z.boolean(),
    correctionMagnitudeEv: z.number().min(0).max(4),
    currentFrameClippedFraction: z.number().min(0).max(1),
    currentFrameExposureOffset: z.number().min(-2).max(2),
    currentSampleClippedFraction: z.number().min(0).max(1),
    currentSampleP99MaxChannel: z.number().min(0).max(1),
    currentSampleRgb: renderedRgbTupleSchema,
    effectiveExposure: z.number().min(-2).max(2),
    offsetClamped: z.boolean(),
    projectedFrameClippedFraction: z.number().min(0).max(1),
    projectedSampleClippedFraction: z.number().min(0).max(1),
    projectedSampleP99MaxChannel: z.number().min(0).max(1),
    projectedSampleRgb: renderedRgbTupleSchema,
    role: z.literal('highlight'),
    sampleRect: negativeLabBaseFogSampleRectSchema,
    status: negativeLabHighlightPatchExposureStatusSchema,
    suggestedExposureDeltaEv: z.number().min(-4).max(0),
    suggestedFrameExposureOffset: z.number().min(-2).max(2),
  })
  .strict();

export type NegativeLabHighlightPatchExposureSuggestion = z.infer<
  typeof negativeLabHighlightPatchExposureSuggestionSchema
>;
