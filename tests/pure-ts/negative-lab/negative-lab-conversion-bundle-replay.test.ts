import { describe, expect, test } from 'bun:test';

import { NEGATIVE_LAB_ACQUISITION_PROFILES } from '../../../src/utils/negative-lab/negativeLabAcquisitionProfiles.ts';
import { replayNegativeLabConversionBundle } from '../../../src/utils/negative-lab/negativeLabConversionBundle.ts';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from '../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';

const sourcePath = '/roll/frame-001-negative.dng';
const sourceHash = 'fnv1a64:0123456789abcdef';

const buildBundle = (overrides: Record<string, unknown> = {}) => ({
  acquisition: {
    selectedProfile: NEGATIVE_LAB_ACQUISITION_PROFILES[0],
    sourceFamilies: ['raw_like'],
    warningCodes: [],
  },
  conversion: {
    acceptedDryRunPlanHash: null,
    acceptedDryRunPlanId: null,
    frameExposureOverrides: { overrides: [], schemaVersion: 1 },
    frameRgbBalanceOverrides: { overrides: [], schemaVersion: 1 },
    outputFormat: 'jpeg_proof',
    params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
    patchSamplerCorrections: { corrections: [], schemaVersion: 1 },
    profileProvenanceHash: null,
    selectedProfile: null,
    suffix: 'Positive',
  },
  doesNotProve: [
    'cryptographic_authenticity',
    'embedded_source_pixels',
    'external_source_relinking',
    'named_stock_colorimetric_match',
    'zip_archive_packaging',
  ],
  outputs: [
    {
      contentHash: 'fnv1a64:fedcba9876543210',
      dimensions: { height: 1200, width: 1800 },
      filename: 'frame-001-negative-Positive.jpg',
      format: 'jpeg_proof',
      path: '/roll/frame-001-negative-Positive.jpg',
      sidecarFilename: 'frame-001-negative-Positive.jpg.rrdata',
      sidecarPath: '/roll/frame-001-negative-Positive.jpg.rrdata',
      source: { contentHash: sourceHash, filename: 'frame-001-negative.dng', path: sourcePath },
    },
  ],
  replay: {
    appServerCommand: 'negative.lab.conversion_plan',
    identityHash: 'fnv1a32:abcdef12',
    requiresSourceFiles: true,
  },
  schemaVersion: 1,
  ...overrides,
});

describe('Negative Lab conversion bundle replay', () => {
  test('hydrates canonical recipe state and records a compatible replay decision', () => {
    const result = replayNegativeLabConversionBundle({
      bundleValue: buildBundle(),
      sessionId: 'negative-lab-replay-001',
      source: { acquisitionProfileId: 'camera_raw_linear_v1', contentHash: sourceHash, path: sourcePath },
      targetPaths: [sourcePath],
    });

    expect(result.report.status).toBe('compatible');
    expect(result.snapshot.session.recipeState.params).toEqual(DEFAULT_NEGATIVE_LAB_UI_PRESET.params);
    expect(result.snapshot.session.recipeState.saveOptions.writeConversionBundle).toBe(true);
    expect(result.snapshot.planState.acceptedApplyPlanFingerprint).toBeNull();
    expect(result.snapshot.proofState.conversionBundleReplay).toEqual(result.report);
  });

  test('blocks a source hash mismatch until explicitly acknowledged', () => {
    const input = {
      bundleValue: buildBundle(),
      sessionId: 'negative-lab-replay-002',
      source: { contentHash: 'fnv1a64:1111111111111111', path: sourcePath },
      targetPaths: [sourcePath],
    };

    expect(() => replayNegativeLabConversionBundle(input)).toThrow('source_content_hash_mismatch');
    const acknowledged = replayNegativeLabConversionBundle({ ...input, acknowledged: true });
    expect(acknowledged.report.status).toBe('review_required');
    expect(acknowledged.report.acknowledged).toBe(true);
  });

  test('blocks a source path mismatch even when the imported bundle is valid', () => {
    expect(() =>
      replayNegativeLabConversionBundle({
        bundleValue: buildBundle(),
        sessionId: 'negative-lab-replay-003',
        source: { path: '/roll/other-negative.dng' },
        targetPaths: ['/roll/other-negative.dng'],
      }),
    ).toThrow('source_path_mismatch');
  });
});
