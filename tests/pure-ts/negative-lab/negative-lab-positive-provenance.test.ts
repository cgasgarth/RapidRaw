import { describe, expect, test } from 'bun:test';

import {
  buildNegativeLabReopenedSavedPositiveArtifactStatus,
  buildNegativeLabReopenedSavedPositiveProvenance,
} from '../../../src/utils/negative-lab/negativeLabSavedPositiveReopen.ts';

const positivePath = '/roll/frame-001-positive.tif';
const sourcePath = '/roll/frame-001-negative.dng';

const buildCurrentMetadata = () => ({
  rawEngineNegativeLabHandoff: {
    artifactId: 'artifact_negative_lab_frame_001',
    conversionBundlePath: `${positivePath}.negative-lab-bundle.json`,
    dimensions: { height: 1200, width: 1800 },
    frameExposureOverrides: { overrides: [], schemaVersion: 1 },
    frameRgbBalanceOverrides: { overrides: [], schemaVersion: 1 },
    outputArtifactId: 'artifact_negative_lab_frame_001_output',
    outputFormat: 'tiff16',
    outputHash: 'fnv1a64:0123456789abcdef',
    outputPath: positivePath,
    path: positivePath,
    positiveVariantId: 'positive_variant_frame_001',
    profileProvenanceHash: 'fnv1a32:12345678',
    replayPlanHash: 'fnv1a32:abcdef12',
    selectedAcquisitionProfile: { id: 'camera_raw_linear_v1' },
    selectedProfile: null,
    sidecarPath: `${positivePath}.rrdata`,
    sourceImageRef: sourcePath,
    sourcePath,
  },
});

const buildStaleMetadata = () => ({
  rawEngineArtifacts: {
    negativeLabArtifacts: [
      {
        artifactId: 'artifact_negative_lab_frame_001',
        conversion: {
          conversionBundlePath: `${positivePath}.negative-lab-bundle.json`,
          frameExposureOverrides: { overrides: [], schemaVersion: 1 },
          frameRgbBalanceOverrides: { overrides: [], schemaVersion: 1 },
          outputFormat: 'tiff16',
          profileProvenanceHash: 'fnv1a32:12345678',
          selectedAcquisitionProfile: { id: 'camera_raw_linear_v1' },
          selectedProfile: null,
        },
        outputArtifacts: [
          {
            artifactId: 'artifact_negative_lab_frame_001_output',
            contentHash: 'fnv1a64:0123456789abcdef',
            dimensions: { height: 1200, width: 1800 },
            outputIntent: 'editable_positive',
            path: positivePath,
            positiveVariantId: 'positive_variant_frame_001',
          },
        ],
        replay: {
          identityHash: 'fnv1a32:abcdef12',
        },
        sidecarPath: `${positivePath}.rrdata`,
        sourceImageRefs: [{ imagePath: sourcePath }],
        staleState: {
          invalidationReasons: ['recipe_hash_changed'],
          state: 'stale',
        },
      },
    ],
    schemaVersion: 1,
    staleArtifactIds: ['artifact_negative_lab_frame_001'],
  },
});

describe('negative lab saved positive provenance', () => {
  test('uses persisted reload handoff data when present', () => {
    const metadata = buildCurrentMetadata();

    expect(buildNegativeLabReopenedSavedPositiveProvenance({ imagePath: positivePath, metadata })).toMatchObject({
      artifactId: 'artifact_negative_lab_frame_001',
      conversionBundlePath: `${positivePath}.negative-lab-bundle.json`,
      outputArtifactId: 'artifact_negative_lab_frame_001_output',
      outputFormat: 'tiff16',
      outputHash: 'fnv1a64:0123456789abcdef',
      outputPath: positivePath,
      profileProvenanceHash: 'fnv1a32:12345678',
      replayPlanHash: 'fnv1a32:abcdef12',
      sidecarPath: `${positivePath}.rrdata`,
      sourcePath,
      state: 'current',
    });
    expect(buildNegativeLabReopenedSavedPositiveArtifactStatus({ imagePath: positivePath, metadata })).toBeNull();
  });

  test('keeps source and output paths distinct on stale persisted artifacts', () => {
    const metadata = buildStaleMetadata();

    expect(buildNegativeLabReopenedSavedPositiveProvenance({ imagePath: positivePath, metadata })).toMatchObject({
      outputPath: positivePath,
      sourcePath,
      state: 'stale',
    });
    expect(buildNegativeLabReopenedSavedPositiveArtifactStatus({ imagePath: positivePath, metadata })).toMatchObject({
      invalidationReasons: ['recipe_hash_changed'],
      state: 'stale',
    });
  });
});
