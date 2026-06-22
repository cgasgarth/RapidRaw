import { z } from 'zod';

import { negativeLabProfileProvenanceHashSchema } from './negativeLabAppServerSchemas';
import {
  negativeLabMeasuredProfileIdSchema,
  negativeLabMeasuredProfileRuntimeLimitationSchema,
  negativeLabMeasuredProfileRuntimeStatusSchema,
  negativeLabRuntimeProfileBrowserRowSchema,
  negativeLabRuntimePresetIdSchema,
  negativeLabUserProfileIdSchema,
} from './negativeLabMeasuredProfileSchemas';
import { negativeLabPresetIdSchema, negativeLabPresetParamsSchema } from './negativeLabPresetCatalogSchemas';

export const negativeLabProfileComparisonDeltaSchema = z
  .object({
    key: z.enum([
      'base_fog_strength',
      'black_point',
      'blue_weight',
      'contrast',
      'exposure',
      'green_weight',
      'red_weight',
      'white_point',
    ]),
    value: z.number(),
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
    displayName: z.string().trim().min(1).max(80),
    doesNotProve: z.array(negativeLabMeasuredProfileRuntimeLimitationSchema),
    evidenceFixtureCount: z.number().int().nonnegative(),
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
    selectedProfileSnapshot: negativeLabSelectedProfileSnapshotSchema,
  })
  .strict();

export const negativeLabProfileComparisonRowsSchema = z.array(negativeLabProfileComparisonRowSchema).min(2);

export type NegativeLabProfileComparisonRow = z.infer<typeof negativeLabProfileComparisonRowSchema>;
export type NegativeLabSelectedProfileSnapshot = z.infer<typeof negativeLabSelectedProfileSnapshotSchema>;
