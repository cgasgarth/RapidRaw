import { readFile } from 'node:fs/promises';

import { negativeLabFixtureManifestEntryV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';

export const unsafeNegativeLabClaimPattern =
  /\b(?:adobe|capture one|dehancer|ektachrome|ektar|exact|fujifilm|fuji|gold|ilford|kodak|lightroom|mastin|negative lab pro|nlp|official|portra|rni|tri-x|t-max|vsco)\b/iu;

export const genericNegativeLabPresetById = new Map(
  NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.map((preset) => [preset.presetId, preset]),
);

export const negativeLabRenderEligiblePayloadAccess = new Set(['committed_public_payload', 'private_ci_payload']);
export const negativeLabRenderValidationUses = ['density_math_reference', 'warning_stability'];
export const requiredNegativeLabPromotionBaseFogRegion = {
  coordinateSpace: 'source_asset_pixels',
  height: 128,
  kind: 'rect',
  width: 256,
  x: 32,
  y: 32,
};

export const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

export const assertGenericNegativeLabCatalogIsNotPromoted = () => {
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

export const isNegativeLabProfileEligibleFixture = (fixture) =>
  fixture.allowedValidationUses.includes('profile_measurement') &&
  !fixture.disallowedValidationUses.includes('profile_measurement') &&
  fixture.state === 'approved_profile_measurement' &&
  ['project_owned_scan', 'licensed_scan'].includes(fixture.negativeFixtureTier) &&
  fixture.targetOrStepWedgePresent &&
  fixture.measurementClaimAllowed &&
  fixture.profileClaimAllowed &&
  fixture.measuredProfileEvidence !== undefined &&
  fixture.autoCorrectionBakedIn === 'known_absent';

export const assertRenderEligibleRealFixture = (entry) => {
  if (!negativeLabRenderEligiblePayloadAccess.has(entry.payloadAccess)) {
    throw new Error(`Promoted real Negative Lab fixture requires renderable payload access: ${entry.fixtureId}`);
  }

  if (entry.contentHash === undefined) {
    throw new Error(`Promoted real Negative Lab fixture requires content hash: ${entry.fixtureId}`);
  }

  if (entry.baseFogSampleRegions.length === 0 || entry.autoCorrectionBakedIn !== 'known_absent') {
    throw new Error(
      `Promoted real Negative Lab fixture requires base/fog sample and no baked auto correction: ${entry.fixtureId}`,
    );
  }

  if (!entry.scannerSoftwareSettingsKnown || entry.expectedFixtureWarningCodes.includes('fixture_payload_not_public')) {
    throw new Error(
      `Promoted real Negative Lab fixture must have known capture settings and public/private payload proof: ${entry.fixtureId}`,
    );
  }

  for (const validationUse of negativeLabRenderValidationUses) {
    if (
      !entry.allowedValidationUses.includes(validationUse) ||
      entry.disallowedValidationUses.includes(validationUse)
    ) {
      throw new Error(
        `Promoted real Negative Lab fixture must allow render validation use ${validationUse}: ${entry.fixtureId}`,
      );
    }
  }
};

export const buildPromotedRealFixture = (manifestEntry, overrides = {}) =>
  negativeLabFixtureManifestEntryV1Schema.parse({
    ...manifestEntry,
    allowedDistribution: 'private_ci_only',
    allowedValidationUses: ['schema_roundtrip', ...negativeLabRenderValidationUses],
    autoCorrectionBakedIn: 'known_absent',
    baseFogSampleRegions: [requiredNegativeLabPromotionBaseFogRegion],
    colorProfile: 'rawengine_camera_tiff_profile_v1',
    contentHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    developmentProcessKnown: true,
    disallowedValidationUses: [
      'ui_overlay_smoke',
      'roll_consistency',
      'profile_measurement',
      'stock_reference_mapping',
      'marketing_screenshot',
    ],
    expectedFixtureWarningCodes: [],
    expectedNegativeWarningCodes: [],
    fixtureId: 'negative_lab.real.approved.c41_color_negative_001',
    negativeFixtureTier: 'project_owned_scan',
    payloadAccess: 'private_ci_payload',
    scanInputMode: 'camera_tiff',
    scannerOrCamera: 'project_owned_camera_scan_station_v1',
    scannerSoftware: 'rawengine_fixture_capture_v1',
    scannerSoftwareSettingsKnown: true,
    source: {
      copyrightOwner: 'RawEngine project',
      licenseName: 'Project-owned private CI fixture',
      redistributionEvidence: 'Private CI payload; public repository stores metadata only.',
      sourceKind: 'project_owned',
    },
    state: 'approved_numeric',
    ...overrides,
  });
