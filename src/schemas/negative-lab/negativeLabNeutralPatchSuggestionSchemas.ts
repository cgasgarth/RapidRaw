import { z } from 'zod';

import {
  negativeLabFrameRgbBalanceOffsetSchema,
  negativeLabFrameRgbBalanceSchema,
} from './negativeLabFrameRgbBalanceOverrideSchemas';
import { negativeLabBaseFogSampleRectSchema } from './negativeLabPresetCatalogSchemas';

export const negativeLabNeutralPatchRiskSchema = z.enum(['high', 'low', 'medium']);

export const negativeLabNeutralPatchSuggestionSchema = z
  .object({
    applicationRisk: negativeLabNeutralPatchRiskSchema,
    applyAllowed: z.boolean(),
    confidence: z.number().min(0).max(1),
    correctionMagnitude: z.number().min(0).max(1.5),
    effectiveRgbBalance: negativeLabFrameRgbBalanceSchema,
    neutralityRisk: negativeLabNeutralPatchRiskSchema,
    offsetClamped: z.boolean(),
    sampleDensity: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]),
    sampleRect: negativeLabBaseFogSampleRectSchema,
    sampleRgb: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
    suggestedRgbBalanceOffset: negativeLabFrameRgbBalanceOffsetSchema,
  })
  .strict();

export type NegativeLabNeutralPatchSuggestion = z.infer<typeof negativeLabNeutralPatchSuggestionSchema>;
