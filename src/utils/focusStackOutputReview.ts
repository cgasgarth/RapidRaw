import { focusStackOutputReviewWorkflowSchema } from '../schemas/focusStackOutputReviewSchemas';

import type { FocusStackArtifactV1 } from '../../packages/rawengine-schema/src/rawEngineSchemas';
import type { FocusStackOutputReviewWorkflow } from '../schemas/focusStackOutputReviewSchemas';
import type { FocusStackUiSettings } from '../schemas/focusStackUiSchemas';

interface BuildFocusStackOutputReviewOptions {
  artifactPath: string;
  settings: FocusStackUiSettings;
  sourceCount: number;
}

const sharpnessCoverageRatio = 1;
const lowConfidenceCellRatio = 0.08;
const haloRiskCellRatio = 0.14;
const haloSuppressionScale = 160;

export const buildFocusStackOutputReviewWorkflow = ({
  artifactPath,
  settings,
  sourceCount,
}: BuildFocusStackOutputReviewOptions): FocusStackOutputReviewWorkflow => {
  const decision = settings.blendMethod === 'weighted_sharpness' ? 'editable_review_required' : 'preview_only';
  const warningCodes: FocusStackOutputReviewWorkflow['warningCodes'] =
    settings.blendMethod === 'weighted_sharpness'
      ? ['human_review_required', 'synthetic_runtime_only', 'transition_halo_risk', 'retouch_layer_deferred']
      : settings.blendMethod === 'depth_map'
        ? ['human_review_required', 'synthetic_runtime_only', 'transition_halo_risk', 'depth_map_preview_only']
        : [
            'human_review_required',
            'synthetic_runtime_only',
            'transition_halo_risk',
            'unsupported_blend_method_preview_only',
          ];
  const effectiveHaloRiskCellRatio = roundRatio(
    Math.max(0.03, haloRiskCellRatio * (1 - settings.haloSuppressionStrengthPercent / haloSuppressionScale)),
  );

  return focusStackOutputReviewWorkflowSchema.parse({
    alignmentMode: settings.alignmentMode,
    artifactPath,
    blendMethod: settings.blendMethod,
    decision,
    editableHandoff: {
      artifactHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      artifactId: artifactPath,
      exportReviewArtifactId: `${artifactPath}:export-review`,
      status: 'review_required',
    },
    haloRiskCellRatio: effectiveHaloRiskCellRatio,
    haloReview: {
      artifactId: `${artifactPath}:halo-review`,
      reviewStatus: 'review_required',
      transitionRiskRegions: buildDefaultTransitionRiskRegions(sourceCount),
    },
    lowConfidenceCellRatio,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    retouchLayerPolicy: settings.retouchLayerPolicy,
    reviewOverlay: {
      confidenceMarginThreshold: 0.12,
      mode: settings.reviewOverlayMode,
      opacityPercent: settings.reviewOverlayOpacityPercent,
      sourceContributionDetails: buildSourceContributionDetails(sourceCount),
      sourceContributionSummary: buildSourceContributionSummary(sourceCount),
    },
    sharpnessCoverageRatio,
    sourceCount,
    warningCodes,
  });
};

export const buildFocusStackOutputReviewFromArtifact = (
  artifact: FocusStackArtifactV1,
): FocusStackOutputReviewWorkflow =>
  focusStackOutputReviewWorkflowSchema.parse({
    alignmentMode: artifact.resolvedAlignmentMode,
    artifactPath: artifact.outputArtifact.artifactId,
    blendMethod: artifact.blendMethod,
    decision:
      artifact.haloReview?.reviewStatus === 'blocked'
        ? 'blocked'
        : artifact.blendMethod === 'weighted_sharpness'
          ? 'editable_review_required'
          : 'preview_only',
    editableHandoff: {
      artifactHash: artifact.outputArtifact.contentHash,
      artifactId: artifact.outputArtifact.artifactId,
      exportReviewArtifactId: `${artifact.outputArtifact.artifactId}:export-review`,
      status: artifact.haloReview?.editableHandoffStatus ?? 'review_required',
    },
    haloRiskCellRatio: artifact.haloReview?.haloRiskCellRatio ?? haloRiskCellRatio,
    haloReview: {
      artifactId: artifact.haloReview?.artifactId ?? `${artifact.outputArtifact.artifactId}:halo-review`,
      reviewStatus: artifact.haloReview?.reviewStatus ?? 'review_required',
      transitionRiskRegions:
        artifact.haloReview?.transitionRiskRegions ??
        buildDefaultTransitionRiskRegions(artifact.sourceImageRefs.length),
    },
    lowConfidenceCellRatio: artifact.haloReview?.lowConfidenceCellRatio ?? lowConfidenceCellRatio,
    proofLevel: 'synthetic_runtime',
    qualityPreference: artifact.qualityPreference,
    retouchLayerPolicy: artifact.retouchLayerPolicy,
    reviewOverlay: {
      confidenceMarginThreshold: 0.12,
      mode: 'halo_risk',
      opacityPercent: 70,
      sourceContributionDetails: buildSourceContributionDetails(artifact.sourceImageRefs.length),
      sourceContributionSummary: buildSourceContributionSummary(artifact.sourceImageRefs.length),
    },
    sharpnessCoverageRatio: artifact.validationSummary.focusCoverageRatio,
    sourceCount: artifact.sourceImageRefs.length,
    warningCodes: ['human_review_required', 'synthetic_runtime_only', 'transition_halo_risk', 'retouch_layer_deferred'],
  });

const buildSourceContributionSummary = (
  sourceCount: number,
): FocusStackOutputReviewWorkflow['reviewOverlay']['sourceContributionSummary'] => {
  const baseRatio = 1 / sourceCount;
  return Array.from({ length: sourceCount }, (_value, sourceIndex) => ({
    sourceIndex,
    winnerCellRatio:
      sourceIndex === sourceCount - 1 ? roundRatio(1 - baseRatio * (sourceCount - 1)) : roundRatio(baseRatio),
  }));
};

const buildSourceContributionDetails = (
  sourceCount: number,
): FocusStackOutputReviewWorkflow['reviewOverlay']['sourceContributionDetails'] =>
  buildSourceContributionSummary(sourceCount).map((source) => ({
    artifactId: `artifact_focus_source_${source.sourceIndex + 1}_contribution`,
    contributionRatio: source.winnerCellRatio,
    sourceId: `S${source.sourceIndex + 1}`,
    sourceIndex: source.sourceIndex,
    warningState: 'artifact_review_required',
  }));

const buildDefaultTransitionRiskRegions = (
  sourceCount: number,
): FocusStackOutputReviewWorkflow['haloReview']['transitionRiskRegions'] =>
  Array.from({ length: sourceCount }, (_value, sourceIndex) => ({
    cellCount: 1,
    regionId: `focus-region-${sourceIndex + 1}`,
    risk: sourceIndex === 0 ? 'stable' : sourceIndex === 1 ? 'low_confidence' : 'halo_risk',
    sourceIndex,
  }));

const roundRatio = (value: number): number => Number(value.toFixed(6));
