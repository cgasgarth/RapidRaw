#!/usr/bin/env bun

import {
  negativeLabFixtureManifestEntryV1Schema,
  negativeLabFixtureManifestV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  assertGenericNegativeLabCatalogIsNotPromoted,
  genericNegativeLabPresetById,
  isNegativeLabProfileEligibleFixture,
  readJson,
} from '../../../scripts/lib/negative-lab-validation.ts';
import {
  negativeLabMeasuredProfileCatalogSchema,
  negativeLabMeasuredProfileSchema,
  negativeLabMeasurementReportSchema,
} from '../../../src/schemas/negativeLabMeasuredProfileSchemas.ts';
import {
  buildNegativeLabAcceptedBatchApplyRouteResult,
  buildNegativeLabAcceptedBatchPlanRouteResult,
  buildNegativeLabConversionPlanResult,
} from '../../../src/utils/negativeLabAppServerRoutes.ts';
import {
  NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
  resolveNegativeLabRuntimeProfile,
} from '../../../src/utils/negativeLabMeasuredProfileRuntime.ts';
import { NegativeLabOutputFormatId } from '../../../src/utils/negativeLabOutputFormatIds.ts';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../../../src/utils/negativeLabPresetCatalog.ts';

const manifestUrl = new URL('../../../fixtures/negative-lab/negative-lab-fixture-manifest.json', import.meta.url);
const measuredCatalogUrl = new URL(
  '../../../fixtures/negative-lab/negative-lab-measured-profile-catalog.json',
  import.meta.url,
);

const validateMeasuredProfileCatalog = (catalog, fixtureEntries) => {
  const fixtureById = new Map(fixtureEntries.map((fixture) => [fixture.fixtureId, fixture]));

  for (const profile of catalog.profiles) {
    const parsedProfile = negativeLabMeasuredProfileSchema.parse(profile);
    const sourcePreset = genericNegativeLabPresetById.get(parsedProfile.sourceGenericPresetId);
    if (sourcePreset === undefined) {
      throw new Error(`Measured Negative Lab profile references unknown generic preset: ${parsedProfile.profileId}`);
    }

    if (
      sourcePreset.filmClass !== parsedProfile.filmClass ||
      sourcePreset.processFamily !== parsedProfile.processFamily
    ) {
      throw new Error(`Measured Negative Lab profile process does not match source preset: ${parsedProfile.profileId}`);
    }

    const fixtureIds = new Set(parsedProfile.evidenceFixtureIds);
    if (fixtureIds.size !== parsedProfile.evidenceFixtureIds.length) {
      throw new Error(`Measured Negative Lab profile has duplicate fixture evidence: ${parsedProfile.profileId}`);
    }

    for (const fixtureId of parsedProfile.evidenceFixtureIds) {
      const fixture = fixtureById.get(fixtureId);
      if (fixture === undefined) {
        throw new Error(`Measured Negative Lab profile references unknown fixture: ${fixtureId}`);
      }

      if (!isNegativeLabProfileEligibleFixture(fixture)) {
        throw new Error(`Measured Negative Lab profile references ineligible fixture: ${fixtureId}`);
      }
    }
  }
};

const validMeasuredFixture = negativeLabFixtureManifestEntryV1Schema.parse({
  allowedDistribution: 'private_ci_only',
  allowedValidationUses: ['schema_roundtrip', 'profile_measurement'],
  autoCorrectionBakedIn: 'known_absent',
  baseFogSampleRegions: [
    { coordinateSpace: 'source_asset_pixels', height: 32, kind: 'rect', width: 160, x: 16, y: 16 },
  ],
  bitDepth: 16,
  captureProfile: 'camera_tiff_profile',
  cleanRoomProvenance: {
    cleanRoomPolicy: 'rawengine_owned_clean_room_v1',
    externalConceptReferences: ['NegPy concepts only'],
    implementationOwner: 'RawEngine project',
    negPyArtifactUse: 'none',
    sourceArtifactBasis: 'rawengine_project_owned_scan_metadata',
    thirdPartyCodeCopied: false,
    thirdPartyConstantsCopied: false,
    thirdPartyDocsCopied: false,
    thirdPartyTestVectorsCopied: false,
  },
  colorProfile: 'rawengine_camera_tiff_profile_v1',
  contentHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  derivativeDistributionAllowed: false,
  developmentNotes: 'Project-owned measured process-family fixture; no named-stock emulation claim.',
  developmentProcessKnown: true,
  disallowedValidationUses: [
    'ui_overlay_smoke',
    'density_math_reference',
    'warning_stability',
    'roll_consistency',
    'stock_reference_mapping',
    'marketing_screenshot',
  ],
  expectedFixtureWarningCodes: [],
  expectedNegativeWarningCodes: [],
  fileFormat: 'tiff',
  filmStockDisplayName: 'Measured C-41 Process-Family Fixture',
  filmStockKnown: false,
  filmStockSource: 'Project-owned measured process-family fixture; no manufacturer or stock claim.',
  fixtureId: 'negative_lab.project_owned.c41_profile_measurement_001',
  fixtureRole: 'profile_measurement',
  frameFormat: '35mm_color_negative_frame_project_owned',
  lens: 'project_owned_macro_lens_v1',
  lightSource: 'calibrated_even_backlight_d65',
  lossyCompression: false,
  measurementClaimAllowed: true,
  measuredProfileEvidence: {
    baseFogSampleCount: 4,
    claimPolicy: 'process_family_profile_no_stock_claim',
    deltaE: { max: 5.4, mean: 1.2, percentile95: 3.1 },
    measurementDate: '2026-06-16',
    measurementReportHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    measurementSoftware: 'rawengine_negative_lab_measurement_harness.v1',
    operator: 'RawEngine fixture validator',
    profileId: 'negative_lab.measured.c41.process_family.v1',
    sourceFixtureIds: ['negative_lab.project_owned.c41_profile_measurement_001'],
    targetReference: {
      id: 'project_target_transparency_001',
      patchCount: 24,
      referenceHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      type: 'it8_transparency',
    },
  },
  negativeFixtureTier: 'project_owned_scan',
  payloadAccess: 'private_ci_payload',
  processFamily: 'c41_color_negative',
  profileClaimAllowed: true,
  rejectedSampleRegions: [],
  reviewIssue: 'https://github.com/cgasgarth/RapidRaw/issues/1539',
  reviewedAt: '2026-06-16',
  reviewer: 'RawEngine fixture validator',
  rollOrSheetIdentifier: 'project_owned_c41_profile_measurement_roll_001',
  scanInputMode: 'camera_tiff',
  scannerOrCamera: 'project_owned_camera_scan_station_v1',
  scannerSoftware: 'rawengine_fixture_measurement_harness.v1',
  scannerSoftwareSettingsKnown: true,
  source: {
    copyrightOwner: 'RawEngine project',
    licenseName: 'Project-owned private CI fixture',
    redistributionEvidence: 'Private CI payload; public repository stores metadata only.',
    sourceKind: 'project_owned',
  },
  state: 'approved_profile_measurement',
  targetOrStepWedgePresent: true,
});

const validMeasuredProfile = {
  calibrationMethod: 'density_matrix_process_family_v1',
  claimLevel: 'measured_profile',
  claimPolicy: 'process_family_profile_no_stock_claim',
  displayName: 'Measured C-41 Process Family',
  doesNotProve: [
    'schema_only',
    'no_runtime_profile_resolver',
    'no_stock_emulation_claim',
    'no_colorimetric_match_claim',
  ],
  evidenceDigest: {
    fixtureLegalStatus: 'project_owned_private_ci',
    renderProofStatus: 'metadata_only',
    sourceFixtureContentHashes: [validMeasuredFixture.contentHash],
  },
  evidenceFixtureIds: [validMeasuredFixture.fixtureId],
  filmClass: 'color_negative',
  measurementProfileId: 'negative_lab.measured.c41.process_family.v1',
  measurementSource: 'fixture_measured_profile',
  params: {
    base_fog_sample: null,
    base_fog_strength: 1,
    blue_weight: 1.02,
    contrast: 1.04,
    exposure: 0,
    green_weight: 0.99,
    red_weight: 1.03,
  },
  processFamily: 'c41_color_negative',
  profileId: 'negative_lab.measured.c41.process_family.v1',
  profileStatus: 'fixture_measured',
  runtimeLimitations: ['Schema and evidence gate only; no measured profile runtime resolver is applied yet.'],
  runtimeStatus: 'ui_catalog_only',
  sourceGenericPresetId: 'negative_lab.generic.c41.neutral.v1',
};

const validRuntimeAppliedMeasuredProfile = {
  ...validMeasuredProfile,
  doesNotProve: ['no_stock_emulation_claim', 'no_colorimetric_match_claim'],
  evidenceDigest: {
    ...validMeasuredProfile.evidenceDigest,
    renderProofStatus: 'runtime_route_verified',
  },
  params: {
    ...validMeasuredProfile.params,
    blue_weight: 1.07,
    contrast: 1.08,
    green_weight: 0.97,
    red_weight: 1.04,
  },
  runtimeLimitations: ['Runtime applies measured process-family parameters; no stock-emulation claim is made.'],
  runtimeStatus: 'runtime_parameter_applied',
};
const validMeasurementReport = {
  calibrationMethod: validRuntimeAppliedMeasuredProfile.calibrationMethod,
  doesNotProve: validRuntimeAppliedMeasuredProfile.doesNotProve,
  evidenceDigest: validRuntimeAppliedMeasuredProfile.evidenceDigest,
  fittedParams: validRuntimeAppliedMeasuredProfile.params,
  generatedAt: '2026-06-16',
  measurementSoftware: 'rawengine_negative_lab_measurement_harness.v1',
  operator: 'RawEngine fixture validator',
  patchMetrics: {
    deltaE00Max: 5.4,
    deltaE00Mean: 1.2,
    deltaE00P95: 3.1,
    rejectedPatchCount: 1,
    usedPatchCount: 23,
  },
  profileId: validRuntimeAppliedMeasuredProfile.profileId,
  reportHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  reportId: 'negative_lab_measurement_report.c41_process_family.v1',
  sourceFixtureIds: validRuntimeAppliedMeasuredProfile.evidenceFixtureIds,
  targetReference: validMeasuredFixture.measuredProfileEvidence.targetReference,
};

const expectReject = (label, catalog, fixtures) => {
  try {
    validateMeasuredProfileCatalog(negativeLabMeasuredProfileCatalogSchema.parse(catalog), fixtures);
    throw new Error(`accepted invalid measured profile case: ${label}`);
  } catch (error) {
    if (error instanceof Error && error.message === `accepted invalid measured profile case: ${label}`) {
      throw error;
    }
  }
};
const expectMeasurementReportReject = (label, report) => {
  try {
    negativeLabMeasurementReportSchema.parse(report);
    throw new Error(`accepted invalid measurement report case: ${label}`);
  } catch (error) {
    if (error instanceof Error && error.message === `accepted invalid measurement report case: ${label}`) {
      throw error;
    }
  }
};

const manifest = negativeLabFixtureManifestV1Schema.parse(await readJson(manifestUrl));
const measuredCatalog = negativeLabMeasuredProfileCatalogSchema.parse(await readJson(measuredCatalogUrl));
const shippedMeasuredProfile = measuredCatalog.profiles.find(
  (profile) => profile.profileId === 'negative_lab.measured.c41.process_family.v1',
);

assertGenericNegativeLabCatalogIsNotPromoted();
validateMeasuredProfileCatalog(measuredCatalog, manifest.entries);
if (shippedMeasuredProfile === undefined) {
  throw new Error('Shipped measured Negative Lab catalog is missing the C-41 process-family profile.');
}
if (
  NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG.measuredCatalog.profiles.length !== measuredCatalog.profiles.length ||
  NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG.measuredCatalog.profiles[0]?.profileId !== shippedMeasuredProfile.profileId
) {
  throw new Error('Runtime measured Negative Lab catalog is not sourced from the shipped measured-profile catalog.');
}
validateMeasuredProfileCatalog(
  negativeLabMeasuredProfileCatalogSchema.parse({
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [validMeasuredProfile],
    schemaVersion: 1,
  }),
  [validMeasuredFixture],
);
negativeLabMeasurementReportSchema.parse(validMeasurementReport);

const runtimeSelfTestCatalog = {
  genericCatalog: NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG,
  measuredCatalog: negativeLabMeasuredProfileCatalogSchema.parse({
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'runtime-self-test',
    profiles: [validRuntimeAppliedMeasuredProfile],
    schemaVersion: 1,
  }),
};
const resolvedRuntimeProfile = resolveNegativeLabRuntimeProfile(
  validRuntimeAppliedMeasuredProfile.profileId,
  runtimeSelfTestCatalog,
);

if (
  resolvedRuntimeProfile.profileStatus !== 'fixture_measured' ||
  resolvedRuntimeProfile.measurementProfileId !== validRuntimeAppliedMeasuredProfile.profileId ||
  resolvedRuntimeProfile.params.red_weight !== validRuntimeAppliedMeasuredProfile.params.red_weight
) {
  throw new Error('Measured Negative Lab runtime resolver did not preserve measured profile provenance and params.');
}

if (
  resolvedRuntimeProfile.evidenceDigest?.renderProofStatus !== 'runtime_route_verified' ||
  resolvedRuntimeProfile.evidenceDigest.sourceFixtureContentHashes[0] !== validMeasuredFixture.contentHash
) {
  throw new Error('Measured Negative Lab runtime resolver did not preserve evidence digest.');
}

const runtimeConversionPlan = buildNegativeLabConversionPlanResult(
  {
    outputFormat: NegativeLabOutputFormatId.Tiff16,
    paths: ['/fixtures/negative-measured.tif'],
    presetId: validRuntimeAppliedMeasuredProfile.profileId,
    sampleRect: validRuntimeAppliedMeasuredProfile.params.base_fog_sample,
    scope: 'active',
    suffix: 'Positive',
  },
  runtimeSelfTestCatalog,
);

if (
  runtimeConversionPlan.profile.profileStatus !== 'fixture_measured' ||
  runtimeConversionPlan.profile.measurementProfileId !== validRuntimeAppliedMeasuredProfile.profileId ||
  !runtimeConversionPlan.profileProvenanceHash.startsWith('fnv1a32:') ||
  runtimeConversionPlan.params.blue_weight !== validRuntimeAppliedMeasuredProfile.params.blue_weight
) {
  throw new Error('Measured Negative Lab app-server conversion plan did not apply measured runtime params.');
}

const runtimeDryRun = {
  activePathIndex: 0,
  baseFogConfidence: 0.9,
  includedPaths: ['/fixtures/negative-measured-a.tif', '/fixtures/negative-measured-b.tif'],
  previewReady: true,
  presetId: validRuntimeAppliedMeasuredProfile.profileId,
  targetPaths: ['/fixtures/negative-measured-a.tif', '/fixtures/negative-measured-b.tif'],
};
const runtimeAcceptedPlan = buildNegativeLabAcceptedBatchPlanRouteResult(runtimeDryRun);
const runtimeAcceptedApply = buildNegativeLabAcceptedBatchApplyRouteResult(
  {
    acceptedPlan: runtimeAcceptedPlan,
    conversion: {
      outputFormat: NegativeLabOutputFormatId.Tiff16,
      paths: runtimeDryRun.targetPaths,
      presetId: validRuntimeAppliedMeasuredProfile.profileId,
      sampleRect: validRuntimeAppliedMeasuredProfile.params.base_fog_sample,
      scope: 'all',
      suffix: 'Positive',
    },
    dryRun: runtimeDryRun,
  },
  runtimeSelfTestCatalog,
);

if (
  runtimeAcceptedApply.conversionPlan.profile.profileStatus !== 'fixture_measured' ||
  runtimeAcceptedApply.apply.options.profileProvenanceHash !==
    runtimeAcceptedApply.conversionPlan.profileProvenanceHash ||
  runtimeAcceptedApply.apply.params.green_weight !== validRuntimeAppliedMeasuredProfile.params.green_weight
) {
  throw new Error('Measured Negative Lab accepted apply plan did not preserve measured profile params.');
}

expectReject(
  'unknown fixture',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [validMeasuredProfile],
    schemaVersion: 1,
  },
  [],
);
expectReject(
  'synthetic fixture',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [{ ...validMeasuredProfile, evidenceFixtureIds: ['negative_lab.synthetic.gray_ramp_base_fog_001'] }],
    schemaVersion: 1,
  },
  manifest.entries,
);
expectReject(
  'process mismatch',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [{ ...validMeasuredProfile, processFamily: 'black_and_white_silver_negative' }],
    schemaVersion: 1,
  },
  [validMeasuredFixture],
);
expectReject(
  'duplicate fixture evidence',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [
      { ...validMeasuredProfile, evidenceFixtureIds: [validMeasuredFixture.fixtureId, validMeasuredFixture.fixtureId] },
    ],
    schemaVersion: 1,
  },
  [validMeasuredFixture],
);
expectReject(
  'runtime applied but still no resolver',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [{ ...validRuntimeAppliedMeasuredProfile, doesNotProve: ['no_runtime_profile_resolver'] }],
    schemaVersion: 1,
  },
  [validMeasuredFixture],
);
expectReject(
  'runtime applied without proof status',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [
      {
        ...validRuntimeAppliedMeasuredProfile,
        evidenceDigest: { ...validRuntimeAppliedMeasuredProfile.evidenceDigest, renderProofStatus: 'metadata_only' },
      },
    ],
    schemaVersion: 1,
  },
  [validMeasuredFixture],
);
expectReject(
  'catalog only without no resolver disclosure',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [{ ...validMeasuredProfile, doesNotProve: ['no_stock_emulation_claim'] }],
    schemaVersion: 1,
  },
  [validMeasuredFixture],
);
expectReject(
  'missing colorimetric disclaimer',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [
      {
        ...validRuntimeAppliedMeasuredProfile,
        doesNotProve: ['no_stock_emulation_claim'],
      },
    ],
    schemaVersion: 1,
  },
  [validMeasuredFixture],
);
expectReject(
  'named stock runtime applied before license gate',
  {
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [
      {
        ...validRuntimeAppliedMeasuredProfile,
        claimPolicy: 'named_stock_profile_requires_license_review',
      },
    ],
    schemaVersion: 1,
  },
  [validMeasuredFixture],
);
expectMeasurementReportReject('missing stock disclaimer', {
  ...validMeasurementReport,
  doesNotProve: ['no_colorimetric_match_claim'],
});
expectMeasurementReportReject('missing colorimetric disclaimer', {
  ...validMeasurementReport,
  doesNotProve: ['no_stock_emulation_claim'],
});
expectMeasurementReportReject('fixture hash mismatch', {
  ...validMeasurementReport,
  evidenceDigest: {
    ...validMeasurementReport.evidenceDigest,
    sourceFixtureContentHashes: [
      validMeasurementReport.evidenceDigest.sourceFixtureContentHashes[0],
      validMeasurementReport.evidenceDigest.sourceFixtureContentHashes[0],
    ],
  },
});
expectMeasurementReportReject('unordered delta e', {
  ...validMeasurementReport,
  patchMetrics: {
    ...validMeasurementReport.patchMetrics,
    deltaE00Mean: 4,
    deltaE00P95: 3,
  },
});

console.log(`negative lab measured profiles ok (${measuredCatalog.profiles.length} shipped profiles)`);
