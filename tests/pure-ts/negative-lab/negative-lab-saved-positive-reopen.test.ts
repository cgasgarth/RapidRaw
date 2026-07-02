import { describe, expect, test } from 'bun:test';

import {
  buildNegativeLabReopenedSavedPositiveHandoff,
  metadataWithNegativeLabReopenedSavedPositiveHandoff,
} from '../../../src/utils/negative-lab/negativeLabSavedPositiveReopen.ts';

const savedPositivePath = '/proof-roll/negative-lab/frame_001-Positive.jpg';
const sourceNegativePath = '/proof-roll/negative-lab/frame_001.NEF';

const persistedPositiveSidecar = {
  rawEngineArtifacts: {
    negativeLabArtifacts: [
      {
        artifactId: 'artifact_negative_lab_reopen_001',
        conversion: {
          acceptedDryRunPlanHash: 'fnv1a32:4b825dc6',
          acceptedDryRunPlanId: 'accepted_plan_reopen_001',
          frameExposureOverrides: {
            overrides: [{ exposureOffset: 0.14, frameId: 'frame_001', sourcePath: sourceNegativePath }],
            schemaVersion: 1,
          },
          frameRgbBalanceOverrides: {
            overrides: [
              {
                frameId: 'frame_001',
                rgbBalanceOffset: { blue: -0.03, green: 0.01, red: 0.02 },
                sourcePath: sourceNegativePath,
              },
            ],
            schemaVersion: 1,
          },
          noOverwritePolicy: 'never_overwrite_original',
          outputFormat: 'jpeg_proof',
          profileProvenanceHash: 'fnv1a32:abcdef12',
          recipeHash: 'fnv1a32:2f4a91bc',
          selectedAcquisitionProfile: {
            id: 'camera_raw_linear_v1',
            name: 'Camera raw linear',
          },
          selectedProfile: {
            profileId: 'negative_lab.generic.c41.reopen_fixture.v1',
            profileProvenanceHash: 'fnv1a32:abcdef12',
          },
        },
        outputArtifacts: [
          {
            artifactId: 'artifact_negative_lab_reopen_001_output',
            contentHash: 'fnv1a64:0123456789abcdef',
            dimensions: { height: 1200, width: 1800 },
            fileState: { path: savedPositivePath },
            format: 'jpeg_proof',
            kind: 'negative_lab_positive',
            outputIntent: 'editable_positive',
            path: savedPositivePath,
            positiveVariantId: 'positive_variant_reopen_001',
            storage: 'sidecar_artifact',
          },
        ],
        replay: {
          appServerCommand: 'negative.lab.conversion_plan',
          identityHash: 'fnv1a32:2f4a91bc',
          requiresSourceFiles: true,
        },
        sidecarPath: `${savedPositivePath}.rawengine-negative-lab.json`,
        sourceImageRefs: [
          {
            contentHash: 'fnv1a64:fedcba9876543210',
            fileState: { path: sourceNegativePath },
            imagePath: sourceNegativePath,
          },
        ],
      },
    ],
    schemaVersion: 1,
  },
};

describe('Negative Lab saved positive reopen hydration', () => {
  test('builds an editor handoff from persisted positive provenance', () => {
    const handoff = buildNegativeLabReopenedSavedPositiveHandoff({
      imagePath: savedPositivePath,
      metadata: persistedPositiveSidecar,
    });

    expect(handoff).toEqual({
      artifactId: 'artifact_negative_lab_reopen_001',
      conversionBundlePath: null,
      dimensions: { height: 1200, width: 1800 },
      frameExposureOverrides:
        persistedPositiveSidecar.rawEngineArtifacts.negativeLabArtifacts[0].conversion.frameExposureOverrides,
      frameRgbBalanceOverrides:
        persistedPositiveSidecar.rawEngineArtifacts.negativeLabArtifacts[0].conversion.frameRgbBalanceOverrides,
      outputArtifactId: 'artifact_negative_lab_reopen_001_output',
      outputFormat: 'jpeg_proof',
      outputHash: 'fnv1a64:0123456789abcdef',
      outputPath: savedPositivePath,
      path: savedPositivePath,
      positiveVariantId: 'positive_variant_reopen_001',
      profileProvenanceHash: 'fnv1a32:abcdef12',
      replayPlanHash: 'fnv1a32:2f4a91bc',
      selectedAcquisitionProfile:
        persistedPositiveSidecar.rawEngineArtifacts.negativeLabArtifacts[0].conversion.selectedAcquisitionProfile,
      selectedProfile: persistedPositiveSidecar.rawEngineArtifacts.negativeLabArtifacts[0].conversion.selectedProfile,
      sidecarPath: `${savedPositivePath}.rawengine-negative-lab.json`,
      sourceImageRef: sourceNegativePath,
      sourcePath: sourceNegativePath,
    });
  });

  test('injects the hydrated handoff into selected-image metadata on reload', () => {
    const metadata = metadataWithNegativeLabReopenedSavedPositiveHandoff({
      imagePath: savedPositivePath,
      metadata: {
        ...persistedPositiveSidecar,
        rating: 4,
      },
    });

    expect(metadata).toMatchObject({
      rating: 4,
      rawEngineNegativeLabHandoff: {
        artifactId: 'artifact_negative_lab_reopen_001',
        outputPath: savedPositivePath,
        replayPlanHash: 'fnv1a32:2f4a91bc',
        sourcePath: sourceNegativePath,
      },
    });
  });

  test('ignores unrelated outputs so ordinary image reload metadata is unchanged', () => {
    const metadata = { ...persistedPositiveSidecar };

    expect(
      buildNegativeLabReopenedSavedPositiveHandoff({
        imagePath: '/proof-roll/negative-lab/unrelated.jpg',
        metadata,
      }),
    ).toBeNull();
    expect(
      metadataWithNegativeLabReopenedSavedPositiveHandoff({
        imagePath: '/proof-roll/negative-lab/unrelated.jpg',
        metadata,
      }),
    ).toBe(metadata);
  });
});
