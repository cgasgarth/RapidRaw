import { superResolutionOutputReviewWorkflowSchema } from '../schemas/superResolutionOutputReviewSchemas';

import type { SuperResolutionOutputReviewWorkflow } from '../schemas/superResolutionOutputReviewSchemas';
import type { SuperResolutionUiSettings } from '../schemas/superResolutionUiSchemas';

interface BuildSuperResolutionOutputReviewOptions {
  artifactPath: string;
  settings: SuperResolutionUiSettings;
  sourceCount: number;
}

const syntheticDetailGainRatio = 1.21;
const reviewCropCount = 4;
const reviewPacketPath = 'docs/validation/sr-synthetic-output-artifact-proof-2026-06-20.json';

export const buildSuperResolutionOutputReviewWorkflow = ({
  artifactPath,
  settings,
  sourceCount,
}: BuildSuperResolutionOutputReviewOptions): SuperResolutionOutputReviewWorkflow => {
  const decision = settings.detailPolicy === 'aggressive_preview_only' ? 'preview_only' : 'human_review_required';
  const warningCodes: SuperResolutionOutputReviewWorkflow['warningCodes'] =
    settings.detailPolicy === 'aggressive_preview_only'
      ? ['human_review_required', 'synthetic_runtime_only', 'texture_risk', 'aggressive_preview_only']
      : ['human_review_required', 'synthetic_runtime_only', 'texture_risk'];

  return superResolutionOutputReviewWorkflowSchema.parse({
    alignmentMode: settings.alignmentMode,
    artifactPath,
    decision,
    detailPolicy: settings.detailPolicy,
    detailGainRatio: syntheticDetailGainRatio,
    outputScale: settings.outputScale,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    reviewCropCount,
    reviewPacketPath,
    sourceCount,
    warningCodes,
  });
};
