import { z } from 'zod';

import { negativeLabFrameRgbBalanceOffsetSchema } from './negativeLabFrameRgbBalanceOverrideSchemas';

export const NEGATIVE_LAB_AUTO_DENSITY_SUGGESTION_SCHEMA_VERSION = 1;

const finiteNumberSchema = z.number().refine(Number.isFinite, { message: 'Expected a finite number.' });

export const negativeLabAutoDensitySuggestionStateSchema = z.enum(['suggested_only', 'accepted_into_plan']);
export const negativeLabAutoDensityContrastGradeSchema = z.enum(['hold', 'lift_contrast', 'soften_contrast']);
export const negativeLabAutoDensityWarningCodeSchema = z.enum([
  'border_density_contamination',
  'cast_balance_low_confidence',
  'clipped_transmittance_samples',
  'confidence_below_apply_threshold',
  'dense_frame',
  'flat_density_field',
  'high_key_frame',
  'insufficient_density_samples',
  'low_key_frame',
  'scan_metrics_unavailable',
  'thin_frame',
]);

export const negativeLabAutoDensityPrintCurveParametersSchema = z
  .object({
    blackPoint: finiteNumberSchema,
    contrast: finiteNumberSchema,
    curveCenter: finiteNumberSchema,
    curveStrength: finiteNumberSchema,
    exposure: finiteNumberSchema,
    whitePoint: finiteNumberSchema,
  })
  .strict();

export const negativeLabAutoDensityFrameSuggestionSchema = z
  .object({
    castBalanceSuggestion: negativeLabFrameRgbBalanceOffsetSchema.nullable(),
    confidence: z.number().min(0).max(1),
    contrastDelta: finiteNumberSchema,
    contrastGrade: negativeLabAutoDensityContrastGradeSchema,
    exposureOffsetEv: finiteNumberSchema,
    frameId: z.string().trim().min(1),
    metricsAudit: z
      .object({
        blueMedianDeviation: finiteNumberSchema,
        greenMedianDeviation: finiteNumberSchema,
        lumaDensityP50: finiteNumberSchema,
        redMedianDeviation: finiteNumberSchema,
        texturalDensityRangeP10P90: finiteNumberSchema,
      })
      .strict(),
    printCurveParameters: negativeLabAutoDensityPrintCurveParametersSchema.nullable(),
    sourcePath: z.string().trim().min(1),
    state: negativeLabAutoDensitySuggestionStateSchema,
    warningCodes: z.array(negativeLabAutoDensityWarningCodeSchema),
  })
  .strict();

export const negativeLabAutoDensitySuggestionRunSchema = z
  .object({
    acceptedDryRunPlanHash: z
      .string()
      .regex(/^fnv1a32:[a-f0-9]{8}$/u)
      .nullable(),
    acceptedDryRunPlanId: z
      .string()
      .regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u)
      .nullable(),
    confidenceThreshold: z.number().min(0).max(1),
    frameSuggestions: z.array(negativeLabAutoDensityFrameSuggestionSchema),
    generatedFrom: z.literal('src/utils/negative-lab/negativeLabAutoDensitySuggestions.ts'),
    referenceDensityP50: finiteNumberSchema.nullable(),
    referenceTexturalRangeP10P90: finiteNumberSchema.nullable(),
    schemaVersion: z.literal(NEGATIVE_LAB_AUTO_DENSITY_SUGGESTION_SCHEMA_VERSION),
    state: negativeLabAutoDensitySuggestionStateSchema,
    warningCodes: z.array(negativeLabAutoDensityWarningCodeSchema),
  })
  .strict()
  .superRefine((run, context) => {
    const frameIds = new Set<string>();
    for (const [index, suggestion] of run.frameSuggestions.entries()) {
      if (frameIds.has(suggestion.frameId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Negative Lab auto density suggestion for ${suggestion.frameId}.`,
          path: ['frameSuggestions', index, 'frameId'],
        });
      }
      frameIds.add(suggestion.frameId);
      if (suggestion.state !== run.state) {
        context.addIssue({
          code: 'custom',
          message: 'Frame suggestion state must match run state.',
          path: ['frameSuggestions', index, 'state'],
        });
      }
    }

    if (
      run.state === 'accepted_into_plan' &&
      (run.acceptedDryRunPlanHash === null || run.acceptedDryRunPlanId === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Accepted auto density suggestion runs must preserve accepted dry-run identity.',
        path: ['acceptedDryRunPlanHash'],
      });
    }

    if (run.state === 'suggested_only' && (run.acceptedDryRunPlanHash !== null || run.acceptedDryRunPlanId !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Suggested-only auto density runs must not carry accepted dry-run identity.',
        path: ['acceptedDryRunPlanHash'],
      });
    }
  });

export type NegativeLabAutoDensitySuggestionState = z.infer<typeof negativeLabAutoDensitySuggestionStateSchema>;
export type NegativeLabAutoDensityWarningCode = z.infer<typeof negativeLabAutoDensityWarningCodeSchema>;
export type NegativeLabAutoDensityFrameSuggestion = z.infer<typeof negativeLabAutoDensityFrameSuggestionSchema>;
export type NegativeLabAutoDensitySuggestionRun = z.infer<typeof negativeLabAutoDensitySuggestionRunSchema>;

export const parseNegativeLabAutoDensitySuggestionRun = (value: unknown): NegativeLabAutoDensitySuggestionRun =>
  negativeLabAutoDensitySuggestionRunSchema.parse(value);
