import { z } from 'zod';

import { negativeLabCrosstalkProfileSchema } from './negativeLabCrosstalkProfileSchemas';
import {
  negativeLabPresetIdSchema,
  negativeLabPresetParamsSchema,
  negativeLabUiPresetFilmClassSchema,
  negativeLabUiPresetProcessFamilySchema,
} from './negativeLabPresetCatalogSchemas';

export const negativeLabMeasuredProfileIdSchema = z
  .string()
  .regex(/^negative_lab\.measured\.(?:c41|bw)\.[a-z0-9_]+\.v[0-9]+$/u);
export const negativeLabUserProfileIdSchema = z
  .string()
  .regex(/^negative_lab\.user\.(?:c41|bw)\.[a-z0-9_]+\.v[0-9]+$/u);

export const negativeLabMeasuredProfileClaimPolicySchema = z.enum([
  'process_family_profile_no_stock_claim',
  'named_stock_profile_requires_license_review',
]);

export const negativeLabMeasuredProfileRuntimeLimitationSchema = z.enum([
  'schema_only',
  'no_runtime_profile_resolver',
  'no_stock_emulation_claim',
  'no_colorimetric_match_claim',
  'user_profile_unmeasured',
]);

export const negativeLabMeasuredProfileRuntimeStatusSchema = z.enum(['ui_catalog_only', 'runtime_parameter_applied']);

export const negativeLabProfileFitReceiptSchema = z
  .object({
    algorithmId: z.literal('native_negative_lab_profile_fit_v1'),
    claimStatus: z.enum(['runtime_parameter_applied', 'blocked_or_unsupported']),
    confidence: z.number().min(0).max(1),
    crosstalkStatus: z.enum(['identity_crosstalk_pending_conditioning', 'identity_not_measured']),
    fittedParams: z
      .object({
        baseFogStrength: z.number().min(0).max(1.25),
        blueWeight: z.number().min(0.5).max(2),
        contrast: z.number().min(0.5).max(2),
        greenWeight: z.number().min(0.5).max(2),
        redWeight: z.number().min(0.5).max(2),
      })
      .strict(),
    maxResidual: z.number().min(0),
    reportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    rejectedPatchCount: z.number().int().nonnegative(),
    residualMean: z.number().min(0),
    schemaVersion: z.literal(1),
    sourceInterpretationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    targetLayoutId: z.literal('rawengine_negative_lab_target_v1'),
    usedPatchCount: z.number().int().positive(),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();
export const negativeLabMeasuredProfileCalibrationMethodSchema = z.enum([
  'density_curve_process_family_v1',
  'density_matrix_process_family_v1',
]);
export const negativeLabMeasuredProfileFixtureLegalStatusSchema = z.enum([
  'licensed_private_ci',
  'project_owned_private_ci',
]);
export const negativeLabMeasuredProfileRenderProofStatusSchema = z.enum([
  'metadata_only',
  'runtime_render_verified',
  'runtime_route_verified',
]);
export const negativeLabMeasuredProfileEvidenceDigestSchema = z
  .object({
    fixtureLegalStatus: negativeLabMeasuredProfileFixtureLegalStatusSchema,
    renderProofStatus: negativeLabMeasuredProfileRenderProofStatusSchema,
    sourceFixtureContentHashes: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/u)).min(1),
  })
  .strict();
export const negativeLabMeasurementReportPatchMetricsSchema = z
  .object({
    deltaE00Max: z.number().min(0),
    deltaE00Mean: z.number().min(0),
    deltaE00P95: z.number().min(0),
    rejectedPatchCount: z.number().int().nonnegative(),
    usedPatchCount: z.number().int().positive(),
  })
  .strict()
  .refine((metrics) => metrics.deltaE00Mean <= metrics.deltaE00P95 && metrics.deltaE00P95 <= metrics.deltaE00Max, {
    message: 'Negative Lab measurement Delta E metrics must be ordered mean <= p95 <= max.',
  });
export const negativeLabMeasurementReportTargetReferenceSchema = z
  .object({
    id: z.string().trim().min(1),
    patchCount: z.number().int().min(12),
    referenceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    type: z.enum(['colorchecker_sg', 'it8_transparency', 'project_synthetic_target', 'step_wedge']),
  })
  .strict();
export const negativeLabMeasurementReportSchema = z
  .object({
    calibrationMethod: negativeLabMeasuredProfileCalibrationMethodSchema,
    doesNotProve: z.array(negativeLabMeasuredProfileRuntimeLimitationSchema).min(1),
    evidenceDigest: negativeLabMeasuredProfileEvidenceDigestSchema,
    fittedParams: negativeLabPresetParamsSchema,
    generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    measurementSoftware: z.string().trim().min(1),
    operator: z.string().trim().min(1),
    patchMetrics: negativeLabMeasurementReportPatchMetricsSchema,
    profileId: negativeLabMeasuredProfileIdSchema,
    reportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    reportId: z.string().regex(/^negative_lab_measurement_report\.[a-z0-9_]+\.v[0-9]+$/u),
    sourceFixtureIds: z.array(z.string().trim().min(1)).min(1),
    targetReference: negativeLabMeasurementReportTargetReferenceSchema,
  })
  .strict()
  .superRefine((report, context) => {
    if (!report.doesNotProve.includes('no_stock_emulation_claim')) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab measurement reports must avoid stock-emulation claims.',
        path: ['doesNotProve'],
      });
    }

    if (!report.doesNotProve.includes('no_colorimetric_match_claim')) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab measurement reports must avoid colorimetric-match claims until render proof matures.',
        path: ['doesNotProve'],
      });
    }

    if (report.sourceFixtureIds.length !== report.evidenceDigest.sourceFixtureContentHashes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab measurement reports must pair each source fixture with a content hash.',
        path: ['evidenceDigest', 'sourceFixtureContentHashes'],
      });
    }
  });

export const negativeLabRuntimePresetIdSchema = z.union([
  negativeLabPresetIdSchema,
  negativeLabMeasuredProfileIdSchema,
  negativeLabUserProfileIdSchema,
]);

export const negativeLabMeasuredProfileSchema = z
  .object({
    claimLevel: z.literal('measured_profile'),
    claimPolicy: negativeLabMeasuredProfileClaimPolicySchema,
    calibrationMethod: negativeLabMeasuredProfileCalibrationMethodSchema,
    crosstalkProfile: negativeLabCrosstalkProfileSchema.nullable().default(null),
    displayName: z.string().trim().min(1).max(80),
    doesNotProve: z.array(negativeLabMeasuredProfileRuntimeLimitationSchema).min(1),
    evidenceDigest: negativeLabMeasuredProfileEvidenceDigestSchema,
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

    if (profile.filmClass === 'black_and_white_silver' && profile.crosstalkProfile !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab crosstalk profiles are hidden for black-and-white silver negatives.',
        path: ['crosstalkProfile'],
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
      profile.runtimeStatus === 'runtime_parameter_applied' &&
      profile.evidenceDigest.renderProofStatus === 'metadata_only'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Runtime-applied measured profiles require route or render proof status.',
        path: ['evidenceDigest', 'renderProofStatus'],
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
export type NegativeLabMeasuredProfileCalibrationMethod = z.infer<
  typeof negativeLabMeasuredProfileCalibrationMethodSchema
>;
export type NegativeLabMeasuredProfileClaimPolicy = z.infer<typeof negativeLabMeasuredProfileClaimPolicySchema>;
export type NegativeLabMeasuredProfileEvidenceDigest = z.infer<typeof negativeLabMeasuredProfileEvidenceDigestSchema>;
export type NegativeLabMeasurementReport = z.infer<typeof negativeLabMeasurementReportSchema>;
export type NegativeLabMeasuredProfileRuntimeStatus = z.infer<typeof negativeLabMeasuredProfileRuntimeStatusSchema>;
export type NegativeLabRuntimePresetId = z.infer<typeof negativeLabRuntimePresetIdSchema>;

export const parseNegativeLabMeasuredProfileCatalog = (value: unknown): NegativeLabMeasuredProfileCatalog =>
  negativeLabMeasuredProfileCatalogSchema.parse(value);

export const parseNegativeLabMeasurementReport = (value: unknown): NegativeLabMeasurementReport =>
  negativeLabMeasurementReportSchema.parse(value);

export const negativeLabRuntimeProfileBrowserRowSchema = z
  .object({
    claimLevel: z.enum(['generic_starting_point_only', 'measured_profile', 'user_profile']),
    claimPolicy: z.enum([
      'generic_starting_point_no_stock_claim',
      'measured_profile_required_before_stock_claim',
      'process_family_profile_no_stock_claim',
      'named_stock_profile_requires_license_review',
      'user_profile_no_stock_claim',
    ]),
    disabledReason: z.enum(['catalog_only', 'license_review_required']).nullable(),
    crosstalkProfile: negativeLabCrosstalkProfileSchema.nullable(),
    displayName: z.string().trim().min(1).max(80),
    doesNotProve: z.array(negativeLabMeasuredProfileRuntimeLimitationSchema),
    evidenceFixtureCount: z.number().int().nonnegative(),
    filmClass: negativeLabUiPresetFilmClassSchema,
    isSelectable: z.boolean(),
    measurementProfileId: negativeLabMeasuredProfileIdSchema.or(negativeLabUserProfileIdSchema).nullable(),
    params: negativeLabPresetParamsSchema,
    presetId: negativeLabRuntimePresetIdSchema,
    processFamily: negativeLabUiPresetProcessFamilySchema,
    profileStatus: z.enum(['generic_unmeasured', 'fixture_measured', 'user_supplied']),
    provenanceSummary: z.string().trim().min(1).max(220),
    runtimeStatus: negativeLabMeasuredProfileRuntimeStatusSchema,
    sourceGenericPresetId: negativeLabPresetIdSchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.isSelectable && row.disabledReason !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Selectable Negative Lab browser rows must not carry disabled reasons.',
        path: ['disabledReason'],
      });
    }

    if (!row.isSelectable && row.disabledReason === null) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled Negative Lab browser rows must explain why they cannot be applied.',
        path: ['disabledReason'],
      });
    }

    if (row.profileStatus === 'generic_unmeasured' && row.evidenceFixtureCount !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Generic Negative Lab browser rows must not carry measured fixture evidence.',
        path: ['evidenceFixtureCount'],
      });
    }

    if (
      row.profileStatus === 'user_supplied' &&
      (row.claimLevel !== 'user_profile' ||
        row.claimPolicy !== 'user_profile_no_stock_claim' ||
        row.measurementProfileId !== row.presetId ||
        row.sourceGenericPresetId === null ||
        !row.doesNotProve.includes('user_profile_unmeasured') ||
        !row.doesNotProve.includes('no_stock_emulation_claim') ||
        !row.doesNotProve.includes('no_colorimetric_match_claim'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'User-owned Negative Lab profile rows must stay claim-limited and tied to a generic base.',
      });
    }

    if (row.filmClass === 'black_and_white_silver' && row.crosstalkProfile !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab crosstalk rows must be hidden for black-and-white profiles.',
        path: ['crosstalkProfile'],
      });
    }
  });

export type NegativeLabRuntimeProfileBrowserRow = z.infer<typeof negativeLabRuntimeProfileBrowserRowSchema>;

export const negativeLabResolvedRuntimeProfileSchema = z
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
    evidenceDigest: negativeLabMeasuredProfileEvidenceDigestSchema.nullable(),
    evidenceFixtureIds: z.array(z.string().trim().min(1)),
    filmClass: negativeLabUiPresetFilmClassSchema,
    measurementProfileId: negativeLabMeasuredProfileIdSchema.or(negativeLabUserProfileIdSchema).nullable(),
    params: negativeLabPresetParamsSchema,
    presetId: negativeLabRuntimePresetIdSchema,
    profileStatus: z.enum(['generic_unmeasured', 'fixture_measured', 'user_supplied']),
    provenanceSummary: z.string().trim().min(1).max(220),
    runtimeStatus: negativeLabMeasuredProfileRuntimeStatusSchema,
    sourceGenericPresetId: negativeLabPresetIdSchema.nullable(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.profileStatus === 'generic_unmeasured') {
      if (
        profile.claimLevel !== 'generic_starting_point_only' ||
        profile.evidenceDigest !== null ||
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
        profile.evidenceDigest === null ||
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

    if (profile.profileStatus === 'user_supplied') {
      if (
        profile.claimLevel !== 'user_profile' ||
        profile.claimPolicy !== 'user_profile_no_stock_claim' ||
        profile.evidenceDigest !== null ||
        profile.measurementProfileId !== profile.presetId ||
        profile.runtimeStatus !== 'runtime_parameter_applied' ||
        profile.sourceGenericPresetId === null ||
        profile.evidenceFixtureIds.length !== 0 ||
        !profile.doesNotProve.includes('user_profile_unmeasured') ||
        !profile.doesNotProve.includes('no_stock_emulation_claim') ||
        !profile.doesNotProve.includes('no_colorimetric_match_claim')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'User-owned runtime profiles must remain unmeasured and claim-limited.',
        });
      }
    }

    if (profile.filmClass === 'black_and_white_silver' && profile.crosstalkProfile !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab crosstalk runtime profile must be disabled for black-and-white profiles.',
        path: ['crosstalkProfile'],
      });
    }
  });

export type NegativeLabResolvedRuntimeProfile = z.infer<typeof negativeLabResolvedRuntimeProfileSchema>;
