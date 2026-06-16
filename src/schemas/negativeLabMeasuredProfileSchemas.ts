import { z } from 'zod';

import {
  negativeLabPresetIdSchema,
  negativeLabPresetParamsSchema,
  negativeLabUiPresetFilmClassSchema,
  negativeLabUiPresetProcessFamilySchema,
} from './negativeLabPresetCatalogSchemas';

export const negativeLabMeasuredProfileIdSchema = z
  .string()
  .regex(/^negative_lab\.measured\.(?:c41|bw)\.[a-z0-9_]+\.v[0-9]+$/u);

export const negativeLabMeasuredProfileClaimPolicySchema = z.enum([
  'process_family_profile_no_stock_claim',
  'named_stock_profile_requires_license_review',
]);

export const negativeLabMeasuredProfileRuntimeLimitationSchema = z.enum([
  'schema_only',
  'no_runtime_profile_resolver',
  'no_stock_emulation_claim',
  'no_colorimetric_match_claim',
]);

export const negativeLabMeasuredProfileSchema = z
  .object({
    claimLevel: z.literal('measured_profile'),
    claimPolicy: negativeLabMeasuredProfileClaimPolicySchema,
    displayName: z.string().trim().min(1).max(80),
    doesNotProve: z.array(negativeLabMeasuredProfileRuntimeLimitationSchema).min(1),
    evidenceFixtureIds: z.array(z.string().trim().min(1)).min(1),
    filmClass: negativeLabUiPresetFilmClassSchema,
    measurementProfileId: negativeLabMeasuredProfileIdSchema,
    measurementSource: z.literal('fixture_measured_profile'),
    params: negativeLabPresetParamsSchema,
    processFamily: negativeLabUiPresetProcessFamilySchema,
    profileId: negativeLabMeasuredProfileIdSchema,
    profileStatus: z.literal('fixture_measured'),
    runtimeLimitations: z.array(z.string().trim().min(1)).min(1),
    runtimeStatus: z.literal('ui_catalog_only'),
    sourceGenericPresetId: negativeLabPresetIdSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.measurementProfileId !== profile.profileId) {
      context.addIssue({
        code: 'custom',
        message: 'Measured Negative Lab profile id and measurement profile id must match.',
        path: ['measurementProfileId'],
      });
    }

    const isBlackAndWhiteProfile = profile.filmClass === 'black_and_white_silver';
    const hasBlackAndWhiteId = profile.profileId.includes('.bw.');
    if (isBlackAndWhiteProfile !== hasBlackAndWhiteId) {
      context.addIssue({
        code: 'custom',
        message: 'Measured Negative Lab profile film class and id must align.',
        path: ['profileId'],
      });
    }

    if (profile.filmClass === 'color_negative' && profile.processFamily !== 'c41_color_negative') {
      context.addIssue({
        code: 'custom',
        message: 'Measured color-negative profiles must declare the C-41 process family.',
        path: ['processFamily'],
      });
    }

    if (profile.filmClass === 'black_and_white_silver' && profile.processFamily !== 'black_and_white_silver_negative') {
      context.addIssue({
        code: 'custom',
        message: 'Measured black-and-white profiles must declare the silver-negative process family.',
        path: ['processFamily'],
      });
    }
  });

export const negativeLabMeasuredProfileCatalogSchema = z
  .object({
    catalogId: z.literal('negative_lab_measured_profile_catalog'),
    catalogVersion: z.string().trim().min(1),
    profiles: z.array(negativeLabMeasuredProfileSchema),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const profileIds = new Set<string>();
    for (const [index, profile] of catalog.profiles.entries()) {
      if (profileIds.has(profile.profileId)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate measured Negative Lab profile id.',
          path: ['profiles', index],
        });
      }
      profileIds.add(profile.profileId);
    }
  });

export type NegativeLabMeasuredProfile = z.infer<typeof negativeLabMeasuredProfileSchema>;
export type NegativeLabMeasuredProfileCatalog = z.infer<typeof negativeLabMeasuredProfileCatalogSchema>;
export type NegativeLabMeasuredProfileClaimPolicy = z.infer<typeof negativeLabMeasuredProfileClaimPolicySchema>;

export const parseNegativeLabMeasuredProfileCatalog = (value: unknown): NegativeLabMeasuredProfileCatalog =>
  negativeLabMeasuredProfileCatalogSchema.parse(value);
