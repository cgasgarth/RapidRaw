#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';
import {
  negativeLabFixtureManifestEntryV1Schema,
  negativeLabFixtureManifestV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { getExtension, toRepoPath, walkRepoFiles } from '../../../scripts/lib/ci/repo-files.ts';

const manifestUrl = new URL('../../../fixtures/negative-lab/negative-lab-fixture-manifest.json', import.meta.url);
const proofUrl = new URL('../../../fixtures/negative-lab/negative-lab-synthetic-fixture-proof.json', import.meta.url);
const updateFixtures = process.argv.includes('--update');

const generator = {
  id: 'rawengine_negative_lab_synthetic_fixture_generator.v1',
  seed: 'negative-lab-fixture-proof-1377',
  version: 1,
};

const allValidationUses = [
  'schema_roundtrip',
  'ui_overlay_smoke',
  'density_math_reference',
  'warning_stability',
  'roll_consistency',
  'profile_measurement',
  'stock_reference_mapping',
  'marketing_screenshot',
];

const rgbSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);
const densityRgbSchema = z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]);
const normalizedRgbSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);
const syntheticCaseSchema = z
  .object({
    baseFogRgb: rgbSchema.nullable(),
    category: z.enum([
      'gray_ramp',
      'color_ramp',
      'missing_base_sample',
      'dense_thin_exposure_offsets',
      'clipped_channel',
      'unknown_acquisition_profile',
    ]),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    expectedNegativeWarningCodes: z.array(z.string()),
    exposureStops: z.array(z.number()),
    fixtureId: z.string().min(1),
    generator: z
      .object({
        id: z.string().min(1),
        seed: z.string().min(1),
        version: z.number().int().positive(),
      })
      .strict(),
    knownPositiveRgb: z.array(rgbSchema).min(1),
    negativeRgb: z.array(rgbSchema).min(1),
    notes: z.string().min(1),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.knownPositiveRgb.length !== fixture.negativeRgb.length) {
      context.addIssue({
        code: 'custom',
        message: 'knownPositiveRgb and negativeRgb must have matching lengths.',
        path: ['negativeRgb'],
      });
    }
  });

const mathHarnessCaseSchema = z
  .object({
    algorithm: z.literal('rawengine_density_log_domain_fixture_v1'),
    densityRgb: z.array(densityRgbSchema).min(1),
    fixtureId: z.string().min(1),
    inputNegativeRgb: z.array(rgbSchema).min(1),
    normalizedDensityRgb: z.array(normalizedRgbSchema).min(1),
    roundTripRgb: z.array(rgbSchema).min(1),
    transformIds: z.array(
      z.enum([
        'linear_rgb_to_density_neg_log10_v1',
        'density_to_linear_rgb_pow10_v1',
        'base_fog_normalized_density_v1',
      ]),
    ),
  })
  .strict()
  .superRefine((fixture, context) => {
    const expectedLength = fixture.inputNegativeRgb.length;
    for (const key of ['densityRgb', 'normalizedDensityRgb', 'roundTripRgb'] as const) {
      if (fixture[key].length !== expectedLength) {
        context.addIssue({
          code: 'custom',
          message: `${key} must match inputNegativeRgb length.`,
          path: [key],
        });
      }
    }
  });

const syntheticProofSchema = z
  .object({
    cases: z.array(syntheticCaseSchema).min(1),
    generator: z
      .object({
        id: z.string().min(1),
        seed: z.string().min(1),
        version: z.number().int().positive(),
      })
      .strict(),
    issue: z.literal(1377),
    mathHarness: z
      .object({
        cases: z.array(mathHarnessCaseSchema).min(1),
        cleanRoomPolicy: z.literal('rawengine_owned_clean_room_v1'),
        doesNotProve: z.array(z.string().trim().min(1)).min(4),
      })
      .strict(),
    schemaVersion: z.literal(1),
  })
  .strict();

const roundChannel = (value) => Math.max(0, Math.min(1, Math.round(value * 10000) / 10000));

const buildNegativeRgb = (knownPositiveRgb, baseFogRgb, exposureStop) => {
  const exposureScale = 2 ** (-exposureStop * 0.35);

  return knownPositiveRgb.map((positive) =>
    positive.map((channel, channelIndex) => {
      const stainScale = [0.78, 0.94, 1.12][channelIndex];
      return roundChannel(baseFogRgb[channelIndex] + (1 - channel) * exposureScale * stainScale * 0.32);
    }),
  );
};

const hashValue = (value) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const withContentHash = (payload) => ({
  ...payload,
  contentHash: hashValue(payload),
});

const buildSyntheticCases = () => [
  withContentHash({
    baseFogRgb: [0.713, 0.486, 0.338],
    category: 'gray_ramp',
    expectedNegativeWarningCodes: [],
    exposureStops: [0],
    fixtureId: 'negative_lab.synthetic.gray_ramp_base_fog_001',
    generator,
    knownPositiveRgb: [
      [0.18, 0.18, 0.18],
      [0.5, 0.5, 0.5],
      [0.82, 0.82, 0.82],
    ],
    negativeRgb: buildNegativeRgb(
      [
        [0.18, 0.18, 0.18],
        [0.5, 0.5, 0.5],
        [0.82, 0.82, 0.82],
      ],
      [0.713, 0.486, 0.338],
      0,
    ),
    notes: 'Known positive gray ramp with visible base/fog for density math smoke checks.',
  }),
  withContentHash({
    baseFogRgb: [0.705, 0.492, 0.35],
    category: 'color_ramp',
    expectedNegativeWarningCodes: [],
    exposureStops: [-1, 0, 1],
    fixtureId: 'negative_lab.synthetic.color_ramp_exposure_offsets_001',
    generator,
    knownPositiveRgb: [
      [0.75, 0.12, 0.12],
      [0.12, 0.72, 0.16],
      [0.13, 0.16, 0.77],
      [0.7, 0.7, 0.18],
      [0.18, 0.68, 0.7],
      [0.68, 0.2, 0.7],
    ],
    negativeRgb: buildNegativeRgb(
      [
        [0.75, 0.12, 0.12],
        [0.12, 0.72, 0.16],
        [0.13, 0.16, 0.77],
        [0.7, 0.7, 0.18],
        [0.18, 0.68, 0.7],
        [0.68, 0.2, 0.7],
      ],
      [0.705, 0.492, 0.35],
      0,
    ),
    notes: 'Known positive color ramp with exposure-offset metadata; no stock/profile quality claim.',
  }),
  withContentHash({
    baseFogRgb: null,
    category: 'missing_base_sample',
    expectedNegativeWarningCodes: ['missing_visible_base'],
    exposureStops: [0],
    fixtureId: 'negative_lab.synthetic.missing_base_sample_warning_001',
    generator,
    knownPositiveRgb: [[0.5, 0.5, 0.5]],
    negativeRgb: [[0.86, 0.78, 0.7]],
    notes: 'Failure-mode fixture with no acceptable base/fog sample region.',
  }),
  withContentHash({
    baseFogRgb: [0.72, 0.49, 0.34],
    category: 'dense_thin_exposure_offsets',
    expectedNegativeWarningCodes: ['low_acquisition_confidence'],
    exposureStops: [-2, 2],
    fixtureId: 'negative_lab.synthetic.dense_thin_exposure_offsets_001',
    generator,
    knownPositiveRgb: [
      [0.28, 0.28, 0.28],
      [0.72, 0.72, 0.72],
    ],
    negativeRgb: [
      ...buildNegativeRgb([[0.28, 0.28, 0.28]], [0.72, 0.49, 0.34], -2),
      ...buildNegativeRgb([[0.72, 0.72, 0.72]], [0.72, 0.49, 0.34], 2),
    ],
    notes: 'Dense and thin negative variants are represented as metadata; numeric quality thresholds are deferred.',
  }),
  withContentHash({
    baseFogRgb: [1, 0.51, 0.35],
    category: 'clipped_channel',
    expectedNegativeWarningCodes: ['clipped_base_channel'],
    exposureStops: [0],
    fixtureId: 'negative_lab.synthetic.clipped_channel_warning_001',
    generator,
    knownPositiveRgb: [[0.4, 0.4, 0.4]],
    negativeRgb: [[1, 0.6905, 0.565]],
    notes: 'Failure-mode fixture with clipped red base/fog channel.',
  }),
  withContentHash({
    baseFogRgb: [0.72, 0.49, 0.34],
    category: 'unknown_acquisition_profile',
    expectedNegativeWarningCodes: ['unknown_input_profile', 'low_acquisition_confidence'],
    exposureStops: [0],
    fixtureId: 'negative_lab.synthetic.unknown_profile_warning_001',
    generator,
    knownPositiveRgb: [[0.6, 0.6, 0.6]],
    negativeRgb: buildNegativeRgb([[0.6, 0.6, 0.6]], [0.72, 0.49, 0.34], 0),
    notes: 'Failure-mode fixture for unknown acquisition profile handling.',
  }),
];

const baseRegion = {
  coordinateSpace: 'source_asset_pixels',
  height: 32,
  kind: 'rect',
  width: 160,
  x: 16,
  y: 16,
};

const cleanRoomProvenance = (sourceArtifactBasis) => ({
  cleanRoomPolicy: 'rawengine_owned_clean_room_v1',
  externalConceptReferences: ['NegPy concepts only'],
  implementationOwner: 'RawEngine project',
  negPyArtifactUse: 'none',
  sourceArtifactBasis,
  thirdPartyCodeCopied: false,
  thirdPartyConstantsCopied: false,
  thirdPartyDocsCopied: false,
  thirdPartyTestVectorsCopied: false,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round6 = (value) => Math.round(value * 1_000_000) / 1_000_000;
const rgbToDensity = (rgb) => rgb.map((channel) => round6(-Math.log10(Math.max(0.000001, Math.min(1, channel)))));
const densityToRgb = (densityRgb) => densityRgb.map((density) => round6(clamp01(10 ** -density)));

const normalizeDensity = (densityRows) => {
  const channelBounds = [0, 1, 2].map((channelIndex) => {
    const values = densityRows.map((row) => row[channelIndex]);
    return {
      max: Math.max(...values),
      min: Math.min(...values),
    };
  });

  return densityRows.map((row) =>
    row.map((density, channelIndex) => {
      const { max, min } = channelBounds[channelIndex];
      return round6(clamp01((density - min) / Math.max(0.0001, max - min)));
    }),
  );
};

const buildMathHarnessCase = (fixture) => {
  const densityRgb = fixture.negativeRgb.map(rgbToDensity);

  return {
    algorithm: 'rawengine_density_log_domain_fixture_v1',
    densityRgb,
    fixtureId: fixture.fixtureId,
    inputNegativeRgb: fixture.negativeRgb,
    normalizedDensityRgb: normalizeDensity(densityRgb),
    roundTripRgb: densityRgb.map(densityToRgb),
    transformIds: [
      'linear_rgb_to_density_neg_log10_v1',
      'density_to_linear_rgb_pow10_v1',
      'base_fog_normalized_density_v1',
    ],
  };
};

const buildDisallowedUses = (allowedValidationUses) =>
  allValidationUses.filter((validationUse) => !allowedValidationUses.includes(validationUse));

const buildSyntheticManifestEntry = (fixture) => {
  const allowedValidationUses =
    fixture.category === 'color_ramp'
      ? ['schema_roundtrip', 'density_math_reference', 'roll_consistency']
      : ['schema_roundtrip', 'density_math_reference', 'warning_stability'];

  return {
    allowedDistribution: 'public_repo',
    allowedValidationUses,
    autoCorrectionBakedIn: 'known_absent',
    baseFogSampleRegions: fixture.baseFogRgb === null ? [] : [baseRegion],
    bitDepth: 16,
    captureProfile:
      fixture.category === 'unknown_acquisition_profile' ? 'unknown_profile_fixture_v1' : 'linear_synthetic_rgb_v1',
    cleanRoomProvenance: cleanRoomProvenance('rawengine_generated_synthetic_math_fixture'),
    colorProfile: 'linear_rec2020_synthetic',
    contentHash: fixture.contentHash,
    derivativeDistributionAllowed: true,
    developmentNotes: fixture.notes,
    developmentProcessKnown: true,
    disallowedValidationUses: buildDisallowedUses(allowedValidationUses),
    expectedFixtureWarningCodes: [],
    expectedNegativeWarningCodes: fixture.expectedNegativeWarningCodes,
    fileFormat: 'synthetic_generated',
    filmStockDisplayName: 'Synthetic Negative Lab Fixture',
    filmStockKnown: false,
    filmStockSource: 'Synthetic fixture, no branded stock claim.',
    fixtureId: fixture.fixtureId,
    fixtureRole: fixture.category === 'color_ramp' ? 'roll_consistency' : 'density_math_reference',
    frameFormat: 'synthetic_35mm_strip',
    generatorId: generator.id,
    lens: 'synthetic_none',
    lightSource: 'synthetic_even_backlight_d65',
    lossyCompression: false,
    measurementClaimAllowed: false,
    negativeFixtureTier: 'synthetic_numeric',
    payloadAccess: 'generated_in_repo',
    processFamily: 'c41_color_negative',
    profileClaimAllowed: false,
    rejectedSampleRegions: [],
    reviewIssue: 'https://github.com/cgasgarth/RapidRaw/issues/1377',
    reviewedAt: '2026-06-16',
    reviewer: 'RawEngine fixture generator',
    rollOrSheetIdentifier: 'synthetic_negative_lab_fixture_roll_001',
    scanInputMode: 'camera_tiff',
    scannerOrCamera: 'synthetic_generator',
    scannerSoftware: generator.id,
    scannerSoftwareSettingsKnown: true,
    source: {
      copyrightOwner: 'RawEngine project',
      licenseName: 'Project-owned synthetic fixture',
      redistributionEvidence: 'Generated by RawEngine fixture tooling; no third-party source scan.',
      sourceKind: 'generated_synthetic',
    },
    state: 'approved_numeric',
    targetOrStepWedgePresent: false,
  };
};

const buildPlannedRealScanEntry = ({
  bitDepth,
  captureProfile,
  developmentNotes,
  expectedNegativeWarningCodes,
  fileFormat,
  fixtureId,
  fixtureRole,
  frameFormat,
  lightSource,
  processFamily,
  rollOrSheetIdentifier,
  scanInputMode,
  sourceArtifactBasis = 'rawengine_local_private_metadata',
}) => ({
  allowedDistribution: 'none',
  allowedValidationUses: ['schema_roundtrip'],
  autoCorrectionBakedIn: 'unknown',
  baseFogSampleRegions: [],
  bitDepth,
  captureProfile,
  colorProfile: `${captureProfile}_pending`,
  cleanRoomProvenance: cleanRoomProvenance(sourceArtifactBasis),
  derivativeDistributionAllowed: false,
  developmentNotes,
  developmentProcessKnown: false,
  disallowedValidationUses: buildDisallowedUses(['schema_roundtrip']),
  expectedFixtureWarningCodes: [
    'fixture_payload_not_public',
    'fixture_setup_unknown',
    'fixture_stock_unverified',
    'fixture_process_unverified',
    'fixture_auto_correction_unknown',
    'fixture_profile_claim_disallowed',
  ],
  expectedNegativeWarningCodes,
  fileFormat,
  filmStockDisplayName: 'Private Real Negative Candidate',
  filmStockKnown: false,
  filmStockSource: 'Local/private candidate; no stock claim in repository metadata.',
  fixtureId,
  fixtureRole,
  frameFormat,
  lens: 'private_camera_scan_lens_pending_review',
  lightSource,
  lossyCompression: fileFormat === 'jpeg',
  measurementClaimAllowed: false,
  negativeFixtureTier: 'local_private_scan',
  payloadAccess: 'metadata_only',
  processFamily,
  profileClaimAllowed: false,
  rejectedSampleRegions: [],
  rollOrSheetIdentifier,
  scanInputMode,
  scannerOrCamera: 'private_camera_scan_pending_review',
  scannerSoftware: 'raw_decoder_pending_review',
  scannerSoftwareSettingsKnown: false,
  source: {
    copyrightOwner: 'Local/private owner not recorded in git',
    sourceKind: 'local_private',
  },
  state: 'review_pending',
  targetOrStepWedgePresent: false,
});

const buildPlannedRealScanEntries = () => [
  buildPlannedRealScanEntry({
    bitDepth: 14,
    captureProfile: 'raw_decoder_camera_profile',
    developmentNotes:
      'Placeholder for a camera-scanned color negative RAW once licensing and ownership review permits use.',
    expectedNegativeWarningCodes: ['unknown_input_profile', 'low_acquisition_confidence'],
    fileFormat: 'raw',
    fixtureId: 'negative_lab.local.camera_raw_color_negative_candidate_001',
    fixtureRole: 'profile_measurement',
    frameFormat: '35mm_color_negative_frame_pending_review',
    lightSource: 'private_even_backlight_pending_review',
    processFamily: 'c41_color_negative',
    rollOrSheetIdentifier: 'private_color_roll_pending_review',
    scanInputMode: 'camera_raw',
  }),
  buildPlannedRealScanEntry({
    bitDepth: 14,
    captureProfile: 'raw_decoder_camera_profile',
    developmentNotes: 'Placeholder for black-and-white silver negative RAW conversion proof and grain/tonality review.',
    expectedNegativeWarningCodes: ['unknown_input_profile', 'low_acquisition_confidence'],
    fileFormat: 'raw',
    fixtureId: 'negative_lab.local.camera_raw_bw_negative_candidate_001',
    fixtureRole: 'profile_measurement',
    frameFormat: '35mm_bw_negative_frame_pending_review',
    lightSource: 'private_even_backlight_pending_review',
    processFamily: 'black_and_white_silver_negative',
    rollOrSheetIdentifier: 'private_bw_roll_pending_review',
    scanInputMode: 'camera_raw',
  }),
  buildPlannedRealScanEntry({
    bitDepth: 16,
    captureProfile: 'camera_tiff_profile',
    developmentNotes:
      'Placeholder for dense/thin exposure range proof where conversion must modify pixels and emit confidence warnings.',
    expectedNegativeWarningCodes: ['unknown_input_profile', 'low_acquisition_confidence'],
    fileFormat: 'tiff',
    fixtureId: 'negative_lab.local.tiff_dense_thin_candidate_001',
    fixtureRole: 'warning_stability',
    frameFormat: 'mixed_density_negative_strip_pending_review',
    lightSource: 'private_even_backlight_pending_review',
    processFamily: 'c41_color_negative',
    rollOrSheetIdentifier: 'private_dense_thin_roll_pending_review',
    scanInputMode: 'camera_tiff',
  }),
  buildPlannedRealScanEntry({
    bitDepth: 16,
    captureProfile: 'camera_tiff_profile',
    developmentNotes:
      'Placeholder for mixed-lighting color negative scan proof where base/fog and color balance warnings remain visible.',
    expectedNegativeWarningCodes: ['unknown_input_profile', 'low_acquisition_confidence'],
    fileFormat: 'tiff',
    fixtureId: 'negative_lab.local.tiff_mixed_lighting_candidate_001',
    fixtureRole: 'roll_consistency',
    frameFormat: 'mixed_lighting_negative_strip_pending_review',
    lightSource: 'mixed_lighting_pending_review',
    processFamily: 'c41_color_negative',
    rollOrSheetIdentifier: 'private_mixed_lighting_roll_pending_review',
    scanInputMode: 'camera_tiff',
  }),
];

const validMeasuredProfileEvidence = {
  baseFogSampleCount: 4,
  claimPolicy: 'process_family_profile_no_stock_claim',
  deltaE: {
    max: 5.4,
    mean: 1.2,
    percentile95: 3.1,
  },
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
};

const buildMeasuredProfilePromotionFixture = (overrides = {}) => {
  const allowedValidationUses = ['schema_roundtrip', 'profile_measurement'];

  return {
    ...buildPlannedRealScanEntry({
      bitDepth: 16,
      captureProfile: 'camera_tiff_profile',
      developmentNotes: 'Project-owned measured process-family profile fixture; no named-stock emulation claim.',
      expectedNegativeWarningCodes: [],
      fileFormat: 'tiff',
      fixtureId: 'negative_lab.project_owned.c41_profile_measurement_001',
      fixtureRole: 'profile_measurement',
      frameFormat: '35mm_color_negative_frame_project_owned',
      lightSource: 'calibrated_even_backlight_d65',
      processFamily: 'c41_color_negative',
      rollOrSheetIdentifier: 'project_owned_c41_profile_measurement_roll_001',
      scanInputMode: 'camera_tiff',
      sourceArtifactBasis: 'rawengine_project_owned_scan_metadata',
    }),
    allowedDistribution: 'private_ci_only',
    allowedValidationUses,
    autoCorrectionBakedIn: 'known_absent',
    baseFogSampleRegions: [baseRegion],
    colorProfile: 'rawengine_camera_tiff_profile_v1',
    developmentProcessKnown: true,
    disallowedValidationUses: buildDisallowedUses(allowedValidationUses),
    expectedFixtureWarningCodes: [],
    filmStockDisplayName: 'Measured C-41 Process-Family Fixture',
    filmStockKnown: false,
    filmStockSource: 'Project-owned measured process-family fixture; no manufacturer or stock claim.',
    measurementClaimAllowed: true,
    measuredProfileEvidence: validMeasuredProfileEvidence,
    negativeFixtureTier: 'project_owned_scan',
    payloadAccess: 'private_ci_payload',
    profileClaimAllowed: true,
    reviewIssue: 'https://github.com/cgasgarth/RapidRaw/issues/1470',
    reviewedAt: '2026-06-16',
    reviewer: 'RawEngine fixture validator',
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
    ...overrides,
  };
};

const assertMeasuredProfilePromotionGate = () => {
  negativeLabFixtureManifestEntryV1Schema.parse(buildMeasuredProfilePromotionFixture());

  for (const [label, fixture] of [
    ['missing measured evidence', buildMeasuredProfilePromotionFixture({ measuredProfileEvidence: undefined })],
    [
      'insufficient target patches',
      buildMeasuredProfilePromotionFixture({
        measuredProfileEvidence: {
          ...validMeasuredProfileEvidence,
          targetReference: { ...validMeasuredProfileEvidence.targetReference, patchCount: 6 },
        },
      }),
    ],
    [
      'named stock claim without known stock',
      buildMeasuredProfilePromotionFixture({
        measuredProfileEvidence: {
          ...validMeasuredProfileEvidence,
          claimPolicy: 'named_stock_profile_requires_license_review',
        },
      }),
    ],
  ]) {
    if (negativeLabFixtureManifestEntryV1Schema.safeParse(fixture).success) {
      throw new Error(`Measured profile promotion gate accepted invalid fixture: ${label}.`);
    }
  }
};

const buildSyntheticProof = () =>
  syntheticProofSchema.parse({
    cases: buildSyntheticCases(),
    generator,
    issue: 1377,
    mathHarness: {
      cases: buildSyntheticCases()
        .filter((fixture) => fixture.category === 'gray_ramp' || fixture.category === 'color_ramp')
        .map(buildMathHarnessCase),
      cleanRoomPolicy: 'rawengine_owned_clean_room_v1',
      doesNotProve: [
        'NegPy parity',
        'named stock emulation accuracy',
        'scanner profile accuracy',
        'camera raw decode path',
      ],
    },
    schemaVersion: 1,
  });

const buildManifest = (proof) =>
  negativeLabFixtureManifestV1Schema.parse({
    entries: [
      ...proof.cases.map(buildSyntheticManifestEntry),
      buildMeasuredProfilePromotionFixture(),
      ...buildPlannedRealScanEntries(),
    ],
    manifestId: 'negative_lab_fixture_manifest',
    manifestVersion: '2026-06-17',
    schemaVersion: 1,
  });

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const assertProofHashes = (proof) => {
  for (const fixture of proof.cases) {
    const { contentHash, ...payload } = fixture;
    const expectedHash = hashValue(payload);
    if (contentHash !== expectedHash) {
      throw new Error(`${fixture.fixtureId} has stale content hash.`);
    }
  }
};

const assertMathHarness = (proof) => {
  const proofById = new Map(proof.cases.map((fixture) => [fixture.fixtureId, fixture]));

  for (const mathCase of proof.mathHarness.cases) {
    const sourceFixture = proofById.get(mathCase.fixtureId);
    if (sourceFixture === undefined) {
      throw new Error(`Math harness references unknown Negative Lab fixture: ${mathCase.fixtureId}.`);
    }

    const expectedCase = buildMathHarnessCase(sourceFixture);
    if (JSON.stringify(mathCase) !== JSON.stringify(expectedCase)) {
      throw new Error(`${mathCase.fixtureId} has stale log-domain math expectations.`);
    }

    mathCase.inputNegativeRgb.forEach((rgb, pixelIndex) => {
      const roundTrip = mathCase.roundTripRgb[pixelIndex];
      const maxDelta = Math.max(...rgb.map((channel, channelIndex) => Math.abs(channel - roundTrip[channelIndex])));
      if (maxDelta > 0.000005) {
        throw new Error(`${mathCase.fixtureId} round-trip RGB drift exceeds tolerance at pixel ${pixelIndex}.`);
      }
    });
  }
};

const assertCoverage = (proof, manifest) => {
  const categories = new Set(proof.cases.map((fixture) => fixture.category));
  for (const category of [
    'gray_ramp',
    'color_ramp',
    'missing_base_sample',
    'dense_thin_exposure_offsets',
    'clipped_channel',
    'unknown_acquisition_profile',
  ]) {
    if (!categories.has(category)) {
      throw new Error(`Missing negative-lab synthetic fixture category: ${category}.`);
    }
  }

  const expectedWarningCodes = new Set(proof.cases.flatMap((fixture) => fixture.expectedNegativeWarningCodes));
  for (const warningCode of ['missing_visible_base', 'clipped_base_channel', 'unknown_input_profile']) {
    if (!expectedWarningCodes.has(warningCode)) {
      throw new Error(`Missing negative-lab warning fixture coverage: ${warningCode}.`);
    }
  }

  for (const fixtureId of [
    'negative_lab.project_owned.c41_profile_measurement_001',
    'negative_lab.local.camera_raw_color_negative_candidate_001',
    'negative_lab.local.camera_raw_bw_negative_candidate_001',
    'negative_lab.local.tiff_dense_thin_candidate_001',
    'negative_lab.local.tiff_mixed_lighting_candidate_001',
  ]) {
    if (!manifest.entries.some((entry) => entry.fixtureId === fixtureId)) {
      throw new Error(`Negative-lab fixture manifest missing real-scan placeholder: ${fixtureId}.`);
    }
  }
};

const assertNoCopiedNegPyArtifacts = async () => {
  const root = process.cwd();
  const checkedExtensions = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.rs', '.json', '.toml', '.yml', '.yaml']);
  const files = walkRepoFiles({
    include: ({ repoPath }) => checkedExtensions.has(getExtension(repoPath)),
    root,
  });
  const copiedArtifactPathPatterns = [
    /(^|\/)negpy(\/|[-_.])/iu,
    /(^|\/)marcinz606(\/|[-_.])/iu,
    /(^|\/)negative[_-]?lab\/.*negpy/iu,
  ];
  const copiedSourceMarkers = [
    /from\s+negpy\s+import/iu,
    /import\s+negpy/iu,
    /marcinz606\/NegPy\/(?:raw|blob|tree)\/(?!main\/LICENSE(?:["')#?]|$))/u,
    /sourceKind["']?\s*:\s*["']negpy/iu,
  ];

  for (const file of files) {
    const repoPath = toRepoPath(root, file);
    if (copiedArtifactPathPatterns.some((pattern) => pattern.test(repoPath))) {
      throw new Error(`Copied NegPy source artifact path is not allowed in RawEngine clean-room fixtures: ${repoPath}`);
    }

    const text = await readFile(file, 'utf8');
    if (copiedSourceMarkers.some((pattern) => pattern.test(text))) {
      throw new Error(`Copied NegPy source marker is not allowed in RawEngine clean-room fixtures: ${repoPath}`);
    }
  }
};

const proof = buildSyntheticProof();
const manifest = buildManifest(proof);
assertProofHashes(proof);
assertMathHarness(proof);
assertCoverage(proof, manifest);
assertMeasuredProfilePromotionGate();
await assertNoCopiedNegPyArtifacts();

if (updateFixtures) {
  await mkdir(dirname(manifestUrl.pathname), { recursive: true });
  await writeFile(proofUrl, stableJson(proof));
  await writeFile(manifestUrl, stableJson(manifest));
  process.exit(0);
}

const currentProof = await readJson(proofUrl);
const currentManifest = await readJson(manifestUrl);
syntheticProofSchema.parse(currentProof);
negativeLabFixtureManifestV1Schema.parse(currentManifest);

if (stableJson(currentProof) !== stableJson(proof)) {
  throw new Error('Negative-lab synthetic fixture proof is stale. Run bun run check:negative-lab-fixtures:update.');
}

if (stableJson(currentManifest) !== stableJson(manifest)) {
  throw new Error('Negative-lab fixture manifest is stale. Run bun run check:negative-lab-fixtures:update.');
}

console.log(`negative lab fixtures ok (${manifest.entries.length} entries)`);
