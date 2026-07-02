import { describe, expect, test } from 'bun:test';

import {
  buildNegativeLabReopenedSavedPositiveArtifactStatus,
  buildNegativeLabReopenedSavedPositiveHandoff,
  metadataWithNegativeLabReopenedSavedPositiveHandoff,
} from '../../../src/utils/negative-lab/negativeLabSavedPositiveReopen.ts';

const positivePath = '/roll/frame-001-positive.tif';
const sourcePath = '/roll/frame-001-negative.dng';

const buildMetadata = (overrides: Record<string, unknown> = {}) => ({
  rawEngineArtifacts: {
    negativeLabArtifacts: [
      {
        artifactId: 'artifact_negative_lab_frame_001',
        conversion: {
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
        sourceImageRefs: [
          {
            contentHash: 'fnv1a64:fedcba9876543210',
            imagePath: sourcePath,
          },
        ],
        staleState: {
          invalidationReasons: [],
          state: 'current',
        },
        ...overrides,
      },
    ],
    schemaVersion: 1,
    staleArtifactIds: [],
  },
});

describe('Negative Lab saved positive reopen provenance', () => {
  test('reopens current positives without stale warnings', () => {
    const metadata = buildMetadata();

    expect(buildNegativeLabReopenedSavedPositiveArtifactStatus({ imagePath: positivePath, metadata })).toMatchObject({
      artifactId: 'artifact_negative_lab_frame_001',
      invalidationReasons: [],
      outputArtifactId: 'artifact_negative_lab_frame_001_output',
      sourceImageRef: sourcePath,
      state: 'current',
    });

    expect(buildNegativeLabReopenedSavedPositiveHandoff({ imagePath: positivePath, metadata })).toMatchObject({
      outputArtifactId: 'artifact_negative_lab_frame_001_output',
      outputHash: 'fnv1a64:0123456789abcdef',
      path: positivePath,
      sourceImageRef: sourcePath,
      sourcePath,
    });
  });

  test('uses persisted staleArtifactIds to block clean editor handoff', () => {
    const metadata = {
      ...buildMetadata(),
      rawEngineArtifacts: {
        ...buildMetadata().rawEngineArtifacts,
        staleArtifactIds: ['artifact_negative_lab_frame_001'],
      },
    };

    expect(buildNegativeLabReopenedSavedPositiveArtifactStatus({ imagePath: positivePath, metadata })).toMatchObject({
      invalidationReasons: ['persisted_stale_artifact_id'],
      state: 'stale',
    });
    expect(buildNegativeLabReopenedSavedPositiveHandoff({ imagePath: positivePath, metadata })).toBeNull();

    expect(metadataWithNegativeLabReopenedSavedPositiveHandoff({ imagePath: positivePath, metadata })).toMatchObject({
      rawEngineNegativeLabPositiveStatus: {
        state: 'stale',
      },
    });
    expect(
      Object.hasOwn(
        metadataWithNegativeLabReopenedSavedPositiveHandoff({ imagePath: positivePath, metadata }) as object,
        'rawEngineNegativeLabHandoff',
      ),
    ).toBe(false);
  });

  test('surfaces missing output artifacts from persisted stale state', () => {
    const metadata = buildMetadata({
      staleState: {
        invalidationReasons: ['output_artifact_missing'],
        state: 'stale',
      },
    });

    expect(buildNegativeLabReopenedSavedPositiveArtifactStatus({ imagePath: positivePath, metadata })).toMatchObject({
      invalidationReasons: ['output_artifact_missing'],
      state: 'missing',
    });
    expect(buildNegativeLabReopenedSavedPositiveHandoff({ imagePath: positivePath, metadata })).toBeNull();
  });

  test('does not remap the source negative when stale source identity changes', () => {
    const replacementSourcePath = '/roll/frame-999-negative.dng';
    const metadata = buildMetadata({
      sourceImageRefs: [
        {
          contentHash: 'fnv1a64:fedcba9876543211',
          imagePath: sourcePath,
          remapCandidatePath: replacementSourcePath,
        },
      ],
      staleState: {
        invalidationReasons: ['source_content_hash_changed'],
        state: 'stale',
      },
    });

    expect(buildNegativeLabReopenedSavedPositiveArtifactStatus({ imagePath: positivePath, metadata })).toMatchObject({
      sourceImageRef: sourcePath,
      state: 'stale',
    });
    expect(buildNegativeLabReopenedSavedPositiveHandoff({ imagePath: positivePath, metadata })).toBeNull();
  });
});
