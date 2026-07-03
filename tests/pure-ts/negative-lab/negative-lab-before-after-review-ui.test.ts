import { describe, expect, test } from 'bun:test';

import { buildNegativeLabBeforeAfterReviewModel } from '../../../src/components/modals/negative-lab/NegativeConversionModal.tsx';

const proof = {
  acceptedDryRunPlanRequirement: {
    acceptedDryRunPlanHash: 'sha256:negative_lab_dry_run_plan_001',
    dryRunPlanId: 'negative_lab_dry_run_plan_001',
    requiredBeforeApply: true,
  },
  baseFogSampleSummary: {
    clippedFraction: 0,
    confidence: 0.88,
    densityRange: 0.09,
    densityRgb: { b: 0.62, g: 0.56, r: 0.53 },
    meanRgb: { b: 0.2399, g: 0.2754, r: 0.2951 },
    sampleCount: 512,
    sampleRect: { height: 0.5, width: 0.1, x: 0.04, y: 0.24 },
    source: 'requested_base_fog_sample_rect',
    warningCodes: ['uneven_illumination'],
  },
  behaviorProofHash: 'sha256:negative_lab_before_after_behavior_001',
  claimLevel: 'measured_project_profile',
  generatedPositiveDryRunArtifact: {
    artifactId: 'artifact_generated_positive',
    contentHash: 'sha256:positive_preview_pixels_001',
    dimensions: { height: 720, width: 1080 },
    kind: 'preview',
    storage: 'temp_cache',
  },
  sourceNegativeArtifact: {
    artifactId: 'artifact_source_negative',
    contentHash: 'sha256:source_negative_pixels_001',
    dimensions: { height: 720, width: 1080 },
    imagePath: '/synthetic/negative-lab-source.dng',
    kind: 'source_negative',
    storage: 'source_file',
  },
  warningCodes: ['low_acquisition_confidence', 'uneven_illumination'],
} as const;

describe('Negative Lab before/after review UI model', () => {
  test('maps runtime proof metadata into source and generated-positive review state', () => {
    const model = buildNegativeLabBeforeAfterReviewModel({
      acceptedDryRunPlanHash: 'sha256:negative_lab_dry_run_plan_001',
      acceptedDryRunPlanId: 'negative_lab_dry_run_plan_001',
      proof,
    });

    expect(model).toMatchObject({
      baseFogConfidence: 0.88,
      claimLevel: 'measured_project_profile',
      generatedPositiveArtifactId: 'artifact_generated_positive',
      generatedPositiveDimensions: { height: 720, width: 1080 },
      isAcceptedPlanCurrent: true,
      sourceNegativeArtifactId: 'artifact_source_negative',
      sourceNegativeDimensions: { height: 720, width: 1080 },
      sourceNegativePath: '/synthetic/negative-lab-source.dng',
      warningCodes: ['low_acquisition_confidence', 'uneven_illumination'],
    });
  });

  test('marks the review as pending when the accepted dry-run identity is stale', () => {
    const model = buildNegativeLabBeforeAfterReviewModel({
      acceptedDryRunPlanHash: 'sha256:stale',
      acceptedDryRunPlanId: 'negative_lab_dry_run_plan_001',
      proof,
    });

    expect(model?.isAcceptedPlanCurrent).toBe(false);
  });
});
