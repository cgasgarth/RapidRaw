#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  negativeLabFixtureManifestEntryV1Schema,
  negativeLabFixtureManifestV1Schema,
} from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  negativeLabMeasuredProfileCatalogSchema,
  negativeLabMeasuredProfileSchema,
} from '../src/schemas/negativeLabMeasuredProfileSchemas.ts';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../src/utils/negativeLabPresetCatalog.ts';

const manifestUrl = new URL('../fixtures/negative-lab/negative-lab-fixture-manifest.json', import.meta.url);
const measuredCatalogUrl = new URL(
  '../fixtures/negative-lab/negative-lab-measured-profile-catalog.json',
  import.meta.url,
);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
const genericPresetById = new Map(
  NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.map((preset) => [preset.presetId, preset]),
);

const assertGenericCatalogIsNotPromoted = () => {
  for (const preset of NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets) {
    if (
      preset.profileStatus !== 'generic_unmeasured' ||
      preset.measurementProfileId !== null ||
      preset.claimLevel !== 'generic_starting_point_only' ||
      preset.measurementSource !== 'generic_engineered_starting_point'
    ) {
      throw new Error(`Generic Negative Lab preset was promoted without measured profile evidence: ${preset.presetId}`);
    }
  }
};

const isProfileEligibleFixture = (fixture) =>
  fixture.allowedValidationUses.includes('profile_measurement') &&
  !fixture.disallowedValidationUses.includes('profile_measurement') &&
  fixture.state === 'approved_profile_measurement' &&
  ['project_owned_scan', 'licensed_scan'].includes(fixture.negativeFixtureTier) &&
  fixture.targetOrStepWedgePresent &&
  fixture.measurementClaimAllowed &&
  fixture.profileClaimAllowed &&
  fixture.measuredProfileEvidence !== undefined &&
  fixture.autoCorrectionBakedIn === 'known_absent';

const validateMeasuredProfileCatalog = (catalog, fixtureEntries) => {
  const fixtureById = new Map(fixtureEntries.map((fixture) => [fixture.fixtureId, fixture]));

  for (const profile of catalog.profiles) {
    const parsedProfile = negativeLabMeasuredProfileSchema.parse(profile);
    const sourcePreset = genericPresetById.get(parsedProfile.sourceGenericPresetId);
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

      if (!isProfileEligibleFixture(fixture)) {
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
  colorProfile: 'rawengine_camera_tiff_profile_v1',
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
  claimLevel: 'measured_profile',
  claimPolicy: 'process_family_profile_no_stock_claim',
  displayName: 'Measured C-41 Process Family',
  doesNotProve: ['schema_only', 'no_stock_emulation_claim', 'no_colorimetric_match_claim'],
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

const manifest = negativeLabFixtureManifestV1Schema.parse(await readJson(manifestUrl));
const measuredCatalog = negativeLabMeasuredProfileCatalogSchema.parse(await readJson(measuredCatalogUrl));

assertGenericCatalogIsNotPromoted();
validateMeasuredProfileCatalog(measuredCatalog, manifest.entries);
validateMeasuredProfileCatalog(
  negativeLabMeasuredProfileCatalogSchema.parse({
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'self-test',
    profiles: [validMeasuredProfile],
    schemaVersion: 1,
  }),
  [validMeasuredFixture],
);

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

console.log(`negative lab measured profiles ok (${measuredCatalog.profiles.length} shipped profiles)`);
