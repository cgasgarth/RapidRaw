import { expect, test } from 'bun:test';

import { sampleFocusStackArtifactV1 } from '../../../packages/rawengine-schema/src/computationalSamplePayloads';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS } from '../../../src/schemas/focus-stack/focusStackUiSchemas';
import { buildFocusStackDerivedOutputReceipt } from '../../../src/utils/derivedOutputReceipt';
import {
  buildFocusStackOutputReviewFromArtifact,
  buildFocusStackOutputReviewWorkflow,
  markFocusStackOutputReviewApplyReady,
} from '../../../src/utils/focusStackOutputReview';
import { buildFocusStackSourcePreflight } from '../../../src/utils/focusStackSourcePreflight';

test('focus stack artifact output review carries apply-capable receipt metadata', () => {
  const review = buildFocusStackOutputReviewFromArtifact({
    ...sampleFocusStackArtifactV1,
    haloReview: {
      ...sampleFocusStackArtifactV1.haloReview,
      editableHandoffStatus: 'ready',
      reviewStatus: 'apply_ready',
    },
    retouchSeed: {
      acceptedDryRunPlanHash: sampleFocusStackArtifactV1.dryRun.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: sampleFocusStackArtifactV1.dryRun.acceptedDryRunPlanId,
      artifactId:
        sampleFocusStackArtifactV1.retouchLayerArtifact?.artifactId ?? 'artifact_focus_stack_macro_0001_retouch_layer',
      availability: 'available',
      maskRegions:
        sampleFocusStackArtifactV1.haloReview?.transitionRiskRegions
          .filter((region) => region.risk !== 'stable')
          .map((region) => ({
            cellCount: region.cellCount,
            regionId: region.regionId,
            risk: region.risk === 'retouch_recommended' ? 'retouch_recommended' : region.risk,
            sourceIndex: region.sourceIndex,
          })) ?? [],
      outputContentHash: sampleFocusStackArtifactV1.outputArtifact.contentHash,
      previewContentHash: sampleFocusStackArtifactV1.previewArtifacts[0]?.contentHash ?? 'sha256:sample-focus-preview',
      reasonCodes: ['halo_risk', 'low_confidence', 'retouch_layer_required'],
      sourceCandidates: sampleFocusStackArtifactV1.sourceImageRefs
        .map((source) => ({
          contentHash:
            sampleFocusStackArtifactV1.sourceState.find((state) => state.sourceIndex === source.sourceIndex)
              ?.contentHash ?? `sha256:focus-source-${source.sourceIndex + 1}`,
          coverageCellCount: 1,
          graphRevision:
            sampleFocusStackArtifactV1.sourceState.find((state) => state.sourceIndex === source.sourceIndex)
              ?.graphRevision ?? `focus_stack_source_${source.sourceIndex}`,
          path: source.imagePath,
          regionIds:
            sampleFocusStackArtifactV1.haloReview?.transitionRiskRegions
              .filter((region) => region.sourceIndex === source.sourceIndex && region.risk !== 'stable')
              .map((region) => region.regionId) ?? [],
          sourceIndex: source.sourceIndex,
        }))
        .filter((candidate) => candidate.regionIds.length > 0),
      staleReasons: [],
      staleState: 'current',
    },
  });

  expect(review.applyReceipt.status).toBe('apply_ready');
  expect(review.applyReceipt.sourceCount).toBe(sampleFocusStackArtifactV1.sourceImageRefs.length);
  expect(review.applyReceipt.alignment.mode).toBe(sampleFocusStackArtifactV1.resolvedAlignmentMode);
  expect(review.applyReceipt.alignment.status).toBe('applied');
  expect(review.applyReceipt.alignment.confidence).toBe(0.92);
  expect(review.applyReceipt.outputPreviewDimensions).toEqual({ height: 1600, width: 2400 });
  expect(review.applyReceipt.sharpnessQualitySummary).toEqual({
    lowConfidenceCellRatio: 0.04,
    qualityPreference: sampleFocusStackArtifactV1.qualityPreference,
    sharpnessCoverageRatio: 0.96,
  });
  expect(review.applyReceipt.artifactHandle).toEqual(sampleFocusStackArtifactV1.outputArtifact);
  expect(review.applyReceipt.artifactPath).toBe(sampleFocusStackArtifactV1.outputArtifact.artifactId);
  expect(review.applyReceipt.warnings).toContain('retouch_layer_required');
  expect(review.retouchSeed?.availability).toBe('available');
  expect(review.retouchSeed?.staleState).toBe('current');
  expect(review.retouchSeed?.maskRegions).toHaveLength(2);

  const receipt = buildFocusStackDerivedOutputReceipt({
    acceptedDryRunPlanHash: sampleFocusStackArtifactV1.dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: sampleFocusStackArtifactV1.dryRun.acceptedDryRunPlanId,
    review,
    settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
  });

  expect(receipt.openInEditorAction.state).toBe('available');
  expect(receipt.openInEditorAction.path).toBe(review.artifactPath);
  expect(receipt.provenanceSidecar?.warnings).toContain('retouch_layer_required');
  expect(receipt.focusStack?.retouchSeed.acceptedDryRunPlanId).toBe(review.retouchSeed?.acceptedDryRunPlanId);
  expect(receipt.provenanceSidecar?.focusStack?.retouchSeed.previewContentHash).toBe(
    review.retouchSeed?.previewContentHash,
  );
});

test('focus stack preview review becomes apply ready through the apply receipt helper', () => {
  const previewReview = buildFocusStackOutputReviewWorkflow({
    artifactPath: '/tmp/focus-stack-preview.tif',
    settings: {
      ...DEFAULT_FOCUS_STACK_UI_SETTINGS,
      blendMethod: 'weighted_sharpness',
      maxPreviewDimensionPx: 1200,
    },
    sourceCount: 3,
    sourcePaths: ['/tmp/focus-0.dng', '/tmp/focus-1.dng', '/tmp/focus-2.dng'],
  });

  expect(previewReview.applyReceipt.status).toBe('review_required');
  expect(previewReview.applyReceipt.outputPreviewDimensions).toEqual({ height: 1200, width: 1200 });

  const appliedReview = markFocusStackOutputReviewApplyReady(previewReview);
  expect(appliedReview.applyReceipt.status).toBe('apply_ready');
  expect(appliedReview.editableHandoff.status).toBe('ready');
  expect(appliedReview.haloReview.reviewStatus).toBe('apply_ready');
});

test('focus stack source preflight warnings remain previewable and expose warning codes', () => {
  const result = buildFocusStackSourcePreflight({
    sources: [
      {
        exif: {
          ISOSpeedRatings: '100',
          LensModel: 'Macro 100',
          Make: 'Acme',
          Model: 'A1',
          SubjectDistance: '0.18',
          WhiteBalance: 'Auto',
        },
        height: 3000,
        imagePath: '/tmp/focus-near.dng',
        sourceIndex: 0,
        width: 4000,
      },
      {
        exif: {
          ISOSpeedRatings: '400',
          LensModel: 'Macro 100',
          Make: 'Acme',
          Model: 'A1',
          SubjectDistance: '0.22',
          WhiteBalance: 'Auto',
        },
        height: 3000,
        imagePath: '/tmp/focus-far.dng',
        sourceIndex: 1,
        width: 4000,
      },
    ],
  });

  expect(result.status).toBe('warning');
  expect(result.validation?.accepted).toBe(true);
  expect(result.validation?.warningCodes).toContain('exposure_or_iso_mismatch');
  expect(result.validation?.blockCodes).toHaveLength(0);
});
