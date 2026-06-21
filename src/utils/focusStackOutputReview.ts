import { focusStackOutputReviewWorkflowSchema } from '../schemas/focusStackOutputReviewSchemas';

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

  return focusStackOutputReviewWorkflowSchema.parse({
    alignmentMode: settings.alignmentMode,
    artifactPath,
    blendMethod: settings.blendMethod,
    decision,
    haloRiskCellRatio,
    lowConfidenceCellRatio,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    retouchLayerPolicy: settings.retouchLayerPolicy,
    reviewOverlay: {
      confidenceMarginThreshold: 0.12,
      mode: settings.reviewOverlayMode,
      opacityPercent: settings.reviewOverlayOpacityPercent,
      sourceContributionSummary: buildSourceContributionSummary(sourceCount),
    },
    sharpnessCoverageRatio,
    sourceCount,
    warningCodes,
  });
};

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

const roundRatio = (value: number): number => Number(value.toFixed(6));
