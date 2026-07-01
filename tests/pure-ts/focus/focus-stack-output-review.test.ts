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

  const receipt = buildFocusStackDerivedOutputReceipt({
    acceptedDryRunPlanHash: sampleFocusStackArtifactV1.dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: sampleFocusStackArtifactV1.dryRun.acceptedDryRunPlanId,
    review,
    settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
  });

  expect(receipt.openInEditorAction.state).toBe('available');
  expect(receipt.openInEditorAction.path).toBe(review.artifactPath);
  expect(receipt.provenanceSidecar?.warnings).toContain('retouch_layer_required');
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
