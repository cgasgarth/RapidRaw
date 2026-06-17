#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  negativeLabFixtureManifestEntryV1Schema,
  negativeLabFixtureManifestV1Schema,
} from '../packages/rawengine-schema/src/rawEngineSchemas.ts';

const manifestUrl = new URL('../fixtures/negative-lab/negative-lab-real-fixture-manifest.json', import.meta.url);
const manifest = negativeLabFixtureManifestV1Schema.parse(JSON.parse(await readFile(manifestUrl, 'utf8')));

const requiredSlots = [
  'negative_lab.real.pending.c41_color_negative_001',
  'negative_lab.real.pending.bw_silver_negative_001',
  'negative_lab.real.pending.c41_dense_thin_roll_001',
  'negative_lab.real.pending.c41_mixed_lighting_001',
];

const entriesById = new Map(manifest.entries.map((entry) => [entry.fixtureId, entry]));

const renderEligiblePayloadAccess = new Set(['committed_public_payload', 'private_ci_payload']);
const renderValidationUses = ['density_math_reference', 'warning_stability'];
const requiredPromotionBaseFogRegion = {
  coordinateSpace: 'source_asset_pixels',
  height: 128,
  kind: 'rect',
  width: 256,
  x: 32,
  y: 32,
};

const assertRenderEligibleRealFixture = (entry) => {
  if (!renderEligiblePayloadAccess.has(entry.payloadAccess)) {
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

  for (const validationUse of renderValidationUses) {
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

const buildPromotedRealFixture = (overrides = {}) =>
  negativeLabFixtureManifestEntryV1Schema.parse({
    ...manifest.entries[0],
    allowedDistribution: 'private_ci_only',
    allowedValidationUses: ['schema_roundtrip', ...renderValidationUses],
    autoCorrectionBakedIn: 'known_absent',
    baseFogSampleRegions: [requiredPromotionBaseFogRegion],
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

const assertPromotionGate = () => {
  assertRenderEligibleRealFixture(buildPromotedRealFixture());

  for (const [label, fixture] of [
    ['missing hash', buildPromotedRealFixture({ contentHash: undefined })],
    ['metadata only', buildPromotedRealFixture({ payloadAccess: 'metadata_only' })],
    ['no base sample', buildPromotedRealFixture({ baseFogSampleRegions: [] })],
    ['unknown scanner settings', buildPromotedRealFixture({ scannerSoftwareSettingsKnown: false })],
    [
      'blocked render use',
      buildPromotedRealFixture({
        allowedValidationUses: ['schema_roundtrip'],
        disallowedValidationUses: ['density_math_reference', 'warning_stability', 'profile_measurement'],
      }),
    ],
  ]) {
    try {
      assertRenderEligibleRealFixture(fixture);
      throw new Error(`Real Negative Lab promotion gate accepted invalid fixture: ${label}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `Real Negative Lab promotion gate accepted invalid fixture: ${label}`
      ) {
        throw error;
      }
    }
  }
};

for (const fixtureId of requiredSlots) {
  const entry = entriesById.get(fixtureId);
  if (entry === undefined) {
    throw new Error(`Missing real Negative Lab fixture slot: ${fixtureId}`);
  }

  if (entry.payloadAccess !== 'metadata_only' || entry.contentHash !== undefined) {
    throw new Error(
      `Pending real Negative Lab fixture must stay metadata-only until payload proof lands: ${fixtureId}`,
    );
  }

  for (const blockedUse of ['density_math_reference', 'roll_consistency', 'profile_measurement']) {
    if (!entry.disallowedValidationUses.includes(blockedUse)) {
      throw new Error(`Pending real Negative Lab fixture must block ${blockedUse}: ${fixtureId}`);
    }
  }

  if (!entry.expectedFixtureWarningCodes.includes('fixture_payload_not_public')) {
    throw new Error(`Pending real Negative Lab fixture must declare missing payload warning: ${fixtureId}`);
  }
}

assertPromotionGate();

console.log(`negative lab real fixtures ok (${manifest.entries.length} metadata-only slots, render proof pending)`);
