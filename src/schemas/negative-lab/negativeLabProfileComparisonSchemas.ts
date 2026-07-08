import { z } from 'zod';

import { negativeLabProfileProvenanceHashSchema } from './negativeLabAppServerSchemas';
import { negativeLabCrosstalkProfileSchema } from './negativeLabCrosstalkProfileSchemas';
import {
  negativeLabMeasuredProfileIdSchema,
  negativeLabMeasuredProfileRuntimeLimitationSchema,
  negativeLabMeasuredProfileRuntimeStatusSchema,
  negativeLabRuntimePresetIdSchema,
  negativeLabRuntimeProfileBrowserRowSchema,
  negativeLabUserProfileIdSchema,
} from './negativeLabMeasuredProfileSchemas';
import { negativeLabPresetIdSchema, negativeLabPresetParamsSchema } from './negativeLabPresetCatalogSchemas';

export const negativeLabProfileComparisonDeltaSchema = z
  .object({
    key: z.enum([
      'analysis_buffer',
      'base_fog_strength',
      'black_point',
      'black_point_offset',
      'blue_weight',
      'contrast',
      'color_range_clip',
      'exposure',
      'green_weight',
      'luma_range_clip',
      'red_weight',
      'white_point',
      'white_point_offset',
    ]),
    value: z.number(),
  })
  .strict();

export const negativeLabProfileComparisonRenderEvidenceSchema = z
  .object({
    baseSampleReference: z.string().trim().min(1),
    densityAlgorithm: z.enum(['density_rgb_v1', 'negative_density_print_v2']),
    metricHash: negativeLabProfileProvenanceHashSchema,
    metrics: z
      .object({
        contrastDeltaAbs: z.number().min(0),
        exposureDeltaAbs: z.number().min(0),
        rgbBalanceDeltaAbs: z.number().min(0),
      })
      .strict(),
    outputTag: z.enum(['preview_display', 'export_linear']),
    previewHash: negativeLabProfileProvenanceHashSchema,
    printCurveVersion: z.enum(['density_print_v2', 'legacy_density_rgb_v1']),
    renderHash: negativeLabProfileProvenanceHashSchema,
    warningCodes: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const negativeLabSelectedProfileSnapshotSchema = z
  .object({
    claimLevel: z.enum(['generic_starting_point_only', 'measured_profile', 'user_profile']),
    claimPolicy: z.enum([
      'generic_starting_point_no_stock_claim',
      'measured_profile_required_before_stock_claim',
      'process_family_profile_no_stock_claim',
      'named_stock_profile_requires_license_review',
      'user_profile_no_stock_claim',
    ]),
    crosstalkProfile: negativeLabCrosstalkProfileSchema.nullable(),
    displayName: z.string().trim().min(1).max(80),
    doesNotProve: z.array(negativeLabMeasuredProfileRuntimeLimitationSchema),
    evidenceFixtureCount: z.number().int().nonnegative(),
    filmClass: z.enum(['color_negative', 'black_and_white_silver']),
    measurementProfileId: negativeLabMeasuredProfileIdSchema.or(negativeLabUserProfileIdSchema).nullable(),
    params: negativeLabPresetParamsSchema,
    presetId: negativeLabRuntimePresetIdSchema,
    profileProvenanceHash: negativeLabProfileProvenanceHashSchema,
    profileStatus: z.enum(['generic_unmeasured', 'fixture_measured', 'user_supplied']),
    provenanceSummary: z.string().trim().min(1).max(220),
    runtimeStatus: negativeLabMeasuredProfileRuntimeStatusSchema,
    sourceGenericPresetId: negativeLabPresetIdSchema.nullable(),
  })
  .strict();

export const negativeLabProfileComparisonRowSchema = z
  .object({
    deltaSummary: z.string().trim().min(1),
    deltas: z.array(negativeLabProfileComparisonDeltaSchema).min(1),
    frameScope: z
      .object({
        activeFrameLabel: z.string().trim().min(1),
        queuedCount: z.number().int().positive(),
      })
      .strict(),
    previewSwatch: z
      .object({
        candidateCss: z
          .string()
          .trim()
          .regex(/^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/u),
        currentCss: z
          .string()
          .trim()
          .regex(/^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/u),
        deltaCss: z
          .string()
          .trim()
          .regex(
            /^linear-gradient\(90deg, rgb\(\d{1,3} \d{1,3} \d{1,3}\) 0 50%, rgb\(\d{1,3} \d{1,3} \d{1,3}\) 50% 100%\)$/u,
          ),
        toneBias: z.enum(['cooler', 'neutral', 'warmer']),
      })
      .strict(),
    profile: negativeLabRuntimeProfileBrowserRowSchema,
    renderEvidence: negativeLabProfileComparisonRenderEvidenceSchema,
    selectedProfileSnapshot: negativeLabSelectedProfileSnapshotSchema,
    mutationSafety: z
      .object({
        browsingMutatesEditGraph: z.literal(false),
        requiresAcceptedPlanForApply: z.literal(true),
        selectableForRuntimeApply: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const negativeLabProfileComparisonRowsSchema = z.array(negativeLabProfileComparisonRowSchema).min(2);

export type NegativeLabProfileComparisonRow = z.infer<typeof negativeLabProfileComparisonRowSchema>;
export type NegativeLabSelectedProfileSnapshot = z.infer<typeof negativeLabSelectedProfileSnapshotSchema>;
