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

export const negativeLabMeasuredProfileRuntimeStatusSchema = z.enum(['ui_catalog_only', 'runtime_parameter_applied']);

export const negativeLabRuntimePresetIdSchema = z.union([
  negativeLabPresetIdSchema,
  negativeLabMeasuredProfileIdSchema,
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
    runtimeStatus: negativeLabMeasuredProfileRuntimeStatusSchema,
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

    const noRuntimeResolverClaimed = profile.doesNotProve.includes('no_runtime_profile_resolver');
    if (profile.runtimeStatus === 'runtime_parameter_applied' && noRuntimeResolverClaimed) {
      context.addIssue({
        code: 'custom',
        message: 'Runtime-applied measured profiles must not claim there is no runtime resolver.',
        path: ['doesNotProve'],
      });
    }

    if (profile.runtimeStatus === 'ui_catalog_only' && !noRuntimeResolverClaimed) {
      context.addIssue({
        code: 'custom',
        message: 'Catalog-only measured profiles must disclose that no runtime resolver applies them yet.',
        path: ['doesNotProve'],
      });
    }

    if (
      profile.claimPolicy === 'named_stock_profile_requires_license_review' &&
      !profile.doesNotProve.includes('no_stock_emulation_claim')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Named-stock measured profiles must explicitly avoid stock-emulation claims.',
        path: ['doesNotProve'],
      });
    }

    if (
      profile.claimPolicy === 'named_stock_profile_requires_license_review' &&
      profile.runtimeStatus === 'runtime_parameter_applied'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Named-stock measured profiles cannot be runtime-applied without a separate license review gate.',
        path: ['runtimeStatus'],
      });
    }

    if (!profile.doesNotProve.includes('no_colorimetric_match_claim')) {
      context.addIssue({
        code: 'custom',
        message: 'Measured Negative Lab profiles must avoid colorimetric match claims until fixture proof exists.',
        path: ['doesNotProve'],
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
export type NegativeLabMeasuredProfileRuntimeStatus = z.infer<typeof negativeLabMeasuredProfileRuntimeStatusSchema>;
export type NegativeLabRuntimePresetId = z.infer<typeof negativeLabRuntimePresetIdSchema>;

export const parseNegativeLabMeasuredProfileCatalog = (value: unknown): NegativeLabMeasuredProfileCatalog =>
  negativeLabMeasuredProfileCatalogSchema.parse(value);

export const negativeLabResolvedRuntimeProfileSchema = z
  .object({
    claimLevel: z.enum(['generic_starting_point_only', 'measured_profile']),
    claimPolicy: z.enum([
      'generic_starting_point_no_stock_claim',
      'measured_profile_required_before_stock_claim',
      'process_family_profile_no_stock_claim',
      'named_stock_profile_requires_license_review',
    ]),
    displayName: z.string().trim().min(1).max(80),
    doesNotProve: z.array(negativeLabMeasuredProfileRuntimeLimitationSchema),
    evidenceFixtureIds: z.array(z.string().trim().min(1)),
    measurementProfileId: negativeLabMeasuredProfileIdSchema.nullable(),
    params: negativeLabPresetParamsSchema,
    presetId: negativeLabRuntimePresetIdSchema,
    profileStatus: z.enum(['generic_unmeasured', 'fixture_measured']),
    provenanceSummary: z.string().trim().min(1).max(220),
    runtimeStatus: negativeLabMeasuredProfileRuntimeStatusSchema,
    sourceGenericPresetId: negativeLabPresetIdSchema.nullable(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.profileStatus === 'generic_unmeasured') {
      if (
        profile.claimLevel !== 'generic_starting_point_only' ||
        profile.measurementProfileId !== null ||
        profile.runtimeStatus !== 'runtime_parameter_applied' ||
        profile.sourceGenericPresetId !== null ||
        profile.evidenceFixtureIds.length !== 0
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Generic runtime profiles must remain unmeasured and provenance-light.',
        });
      }
    }

    if (profile.profileStatus === 'fixture_measured') {
      if (
        profile.claimLevel !== 'measured_profile' ||
        profile.measurementProfileId === null ||
        profile.runtimeStatus !== 'runtime_parameter_applied' ||
        profile.sourceGenericPresetId === null ||
        profile.evidenceFixtureIds.length === 0
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Fixture-measured runtime profiles must carry applied measured provenance.',
        });
      }
    }
  });

export type NegativeLabResolvedRuntimeProfile = z.infer<typeof negativeLabResolvedRuntimeProfileSchema>;
