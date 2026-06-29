import { focusStackOutputReviewWorkflowSchema } from '../schemas/focusStackOutputReviewSchemas';

import type { FocusStackArtifactV1 } from '../../packages/rawengine-schema/src/rawEngineSchemas';
import type { FocusStackOutputReviewWorkflow } from '../schemas/focusStackOutputReviewSchemas';
import type { FocusStackUiSettings } from '../schemas/focusStackUiSchemas';

interface BuildFocusStackOutputReviewOptions {
  artifactPath: string;
  settings: FocusStackUiSettings;
  sourceCount: number;
  sourcePaths?: string[];
}

const sharpnessCoverageRatio = 1;
const lowConfidenceCellRatio = 0.08;
const haloRiskCellRatio = 0.14;
const haloSuppressionScale = 160;

export const buildFocusStackOutputReviewWorkflow = ({
  artifactPath,
  settings,
  sourceCount,
  sourcePaths = [],
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
      retouchedExportParity:
        settings.retouchLayerPolicy === 'generate_retouch_layer'
          ? {
              comparedFields: [
                'acceptedDryRunPlan',
                'outputArtifact',
                'retouchLayerArtifact',
                'retouchLayerPolicy',
                'sharpnessSettings',
                'sourceState',
              ],
              exportReceiptHash: 'fnv1a32:00000000',
              meanAbsDelta: 0,
              parityProofHash: 'fnv1a32:00000000',
              previewStateHash: 'fnv1a32:00000000',
              status: 'matched_retouched_sidecar_output',
            }
          : undefined,
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
    sourceRefs: buildSourceRefs(sourceCount, sourcePaths),
    warningCodes,
  });
};

export const buildFocusStackOutputReviewFromArtifact = (
  artifact: FocusStackArtifactV1,
): FocusStackOutputReviewWorkflow => {
  const sourceRefs = artifact.sourceImageRefs.map((source, sourceIndex) => {
    const sourceState = artifact.sourceState.find((state) => state.sourceIndex === source.sourceIndex);
    return {
      contentHash: sourceState?.contentHash ?? hashStableJson({ path: source.imagePath, sourceIndex }),
      graphRevision: sourceState?.graphRevision ?? `focus_stack_source_${sourceIndex}`,
      path: source.imagePath,
      sourceIndex,
    };
  });

  return focusStackOutputReviewWorkflowSchema.parse({
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
      retouchedExportParity: artifact.retouchedExportParity,
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
    sourceRefs,
    warningCodes: ['human_review_required', 'synthetic_runtime_only', 'transition_halo_risk', 'retouch_layer_deferred'],
  });
};

const buildSourceRefs = (sourceCount: number, sourcePaths: string[]): FocusStackOutputReviewWorkflow['sourceRefs'] =>
  Array.from({ length: sourceCount }, (_value, sourceIndex) => {
    const path = sourcePaths[sourceIndex] ?? `focus-stack-source-${sourceIndex}`;
    return {
      contentHash: hashStableJson({ path, sourceIndex }),
      graphRevision: `focus_stack_source_${sourceIndex}`,
      path,
      sourceIndex,
    };
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
  buildSourceContributionSummary(sourceCount).map((source) => {
    const coverageCellCount = Math.max(1, Math.round(source.winnerCellRatio * sourceCount * 12));
    const confidencePercent = Math.max(62, Math.round((1 - lowConfidenceCellRatio) * 100 - source.sourceIndex * 2));
    return {
      artifactId: `artifact_focus_source_${source.sourceIndex + 1}_contribution`,
      confidencePercent,
      contributionRatio: source.winnerCellRatio,
      coverageCellCount,
      sourceId: `S${source.sourceIndex + 1}`,
      sourceIndex: source.sourceIndex,
      warningState: confidencePercent < 70 ? 'artifact_review_required' : 'clear',
    };
  });

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

const hashStableJson = (value: unknown): string => `fnv1a32:${fnv1a32(stableJson(value))}`;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
