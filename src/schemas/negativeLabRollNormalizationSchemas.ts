import { z } from 'zod';

import { negativeLabAutoDensitySuggestionRunSchema } from './negativeLabAutoDensitySuggestionSchemas';
import { negativeLabFrameExposureOverridePayloadSchema } from './negativeLabFrameExposureOverrideSchemas';
import { negativeLabFrameRgbBalanceOverridePayloadSchema } from './negativeLabFrameRgbBalanceOverrideSchemas';

export const NEGATIVE_LAB_ROLL_NORMALIZATION_SCHEMA_VERSION = 1;

export const negativeLabRollNormalizationModeSchema = z.enum([
  'density_and_balance',
  'exposure_only',
  'white_balance_only',
]);

export const negativeLabRollNormalizationPlanSchema = z
  .object({
    affectedFrameIds: z.array(z.string().trim().min(1)),
    anchorFrameIds: z.array(z.string().trim().min(1)).min(1),
    autoDensitySuggestionRun: negativeLabAutoDensitySuggestionRunSchema.nullable(),
    exposureOverrides: negativeLabFrameExposureOverridePayloadSchema,
    mode: negativeLabRollNormalizationModeSchema,
    positiveVariantIds: z.array(z.string().trim().min(1)),
    preserveCreativeAdjustments: z.boolean(),
    proposedExposureDeltaEv: z.number(),
    proposedWhiteBalanceDelta: z.number().nonnegative(),
    rgbBalanceOverrides: negativeLabFrameRgbBalanceOverridePayloadSchema,
    schemaVersion: z.literal(NEGATIVE_LAB_ROLL_NORMALIZATION_SCHEMA_VERSION),
    skippedFrameIds: z.array(z.string().trim().min(1)),
    unaffectedFrameIds: z.array(z.string().trim().min(1)),
    warningCodes: z.array(z.enum(['acquisition_review_required', 'no_selected_frames', 'normalization_preview_only'])),
  })
  .strict()
  .superRefine((plan, context) => {
    const affectedFrameIds = new Set(plan.affectedFrameIds);
    for (const frameId of plan.unaffectedFrameIds) {
      if (affectedFrameIds.has(frameId)) {
        context.addIssue({
          code: 'custom',
          message: 'Roll normalization unaffected frames must not also be affected.',
          path: ['unaffectedFrameIds'],
        });
      }
    }

    if (plan.affectedFrameIds.length === 0 && !plan.warningCodes.includes('no_selected_frames')) {
      context.addIssue({
        code: 'custom',
        message: 'Empty roll normalization plans must disclose no selected frames.',
        path: ['warningCodes'],
      });
    }
  });

export type NegativeLabRollNormalizationMode = z.infer<typeof negativeLabRollNormalizationModeSchema>;
export type NegativeLabRollNormalizationPlan = z.infer<typeof negativeLabRollNormalizationPlanSchema>;

export const parseNegativeLabRollNormalizationPlan = (value: unknown): NegativeLabRollNormalizationPlan =>
  negativeLabRollNormalizationPlanSchema.parse(value);
