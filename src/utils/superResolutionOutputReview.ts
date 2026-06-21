import { superResolutionOutputReviewWorkflowSchema } from '../schemas/superResolutionOutputReviewSchemas';

import type { SuperResolutionOutputReviewWorkflow } from '../schemas/superResolutionOutputReviewSchemas';
import type { SuperResolutionUiSettings } from '../schemas/superResolutionUiSchemas';

type SuperResolutionArtifactReviewInput = {
  decisionStatus: 'blocked' | 'downgraded' | 'eligible_for_apply' | 'preview_only';
  detailPolicy: SuperResolutionUiSettings['detailPolicy'];
  outputArtifact: {
    artifactId: string;
    contentHash?: string;
    dimensions?: {
      height: number;
      width: number;
    };
  };
  qualityPreference: SuperResolutionUiSettings['qualityPreference'];
  requestedOutputScale: number;
  resolvedAlignmentMode: SuperResolutionUiSettings['alignmentMode'];
  staleState: {
    state: SuperResolutionOutputReviewWorkflow['staleState'];
  };
  validationSummary: {
    expectedDetailGainRatio?: number;
    humanReviewStatus: SuperResolutionOutputReviewWorkflow['humanReviewStatus'];
    overlapCoverageRatio?: number;
    sourceCount: number;
  };
  warningCodes: SuperResolutionOutputReviewWorkflow['warningCodes'];
};

interface BuildSuperResolutionOutputReviewOptions {
  artifactPath: string;
  settings: SuperResolutionUiSettings;
  sourceCount: number;
}

const reviewCropCount = 4;
const reviewPacketPath = 'docs/validation/sr-synthetic-output-artifact-proof-2026-06-20.json';

export const buildSuperResolutionOutputReviewFromArtifact = (
  artifactValue: SuperResolutionArtifactReviewInput,
): SuperResolutionOutputReviewWorkflow => {
  const outputHash = artifactValue.outputArtifact.contentHash;
  if (outputHash === undefined) {
    throw new Error('SR output review requires output artifact content hash.');
  }
  const outputDimensions = artifactValue.outputArtifact.dimensions;
  if (outputDimensions === undefined) {
    throw new Error('SR output review requires output artifact dimensions.');
  }

  return superResolutionOutputReviewWorkflowSchema.parse({
    alignmentMode: artifactValue.resolvedAlignmentMode,
    artifactPath: artifactValue.outputArtifact.artifactId,
    decision: deriveDecision(artifactValue),
    detailGainRatio: artifactValue.validationSummary.expectedDetailGainRatio ?? null,
    detailPolicy: artifactValue.detailPolicy,
    editableGate: deriveEditableGate(artifactValue),
    humanReviewStatus: artifactValue.validationSummary.humanReviewStatus,
    outputArtifactHash: outputHash,
    outputArtifactId: artifactValue.outputArtifact.artifactId,
    outputHeight: outputDimensions.height,
    outputScale: artifactValue.requestedOutputScale,
    outputWidth: outputDimensions.width,
    overlapCoverageRatio: artifactValue.validationSummary.overlapCoverageRatio ?? null,
    proofLevel: 'synthetic_runtime',
    qualityPreference: artifactValue.qualityPreference,
    reviewCropCount,
    reviewPacketPath,
    sourceCount: artifactValue.validationSummary.sourceCount,
    staleState: artifactValue.staleState.state,
    warningCodes: artifactValue.warningCodes,
  });
};

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
    detailGainRatio: null,
    editableGate: 'blocked_review_required',
    humanReviewStatus: 'pending',
    outputArtifactHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    outputArtifactId: artifactPath,
    outputHeight: 1,
    outputScale: settings.outputScale,
    outputWidth: 1,
    overlapCoverageRatio: null,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    reviewCropCount,
    reviewPacketPath,
    sourceCount,
    staleState: 'unknown',
    warningCodes,
  });
};

const deriveDecision = (
  artifact: SuperResolutionArtifactReviewInput,
): SuperResolutionOutputReviewWorkflow['decision'] => {
  if (artifact.decisionStatus === 'preview_only' || artifact.detailPolicy === 'aggressive_preview_only') {
    return 'preview_only';
  }
  if (artifact.validationSummary.humanReviewStatus === 'failed' || artifact.staleState.state !== 'current') {
    return 'blocked';
  }
  return 'human_review_required';
};

const deriveEditableGate = (
  artifact: SuperResolutionArtifactReviewInput,
): SuperResolutionOutputReviewWorkflow['editableGate'] => {
  if (artifact.staleState.state !== 'current') return 'blocked_stale';
  if (artifact.validationSummary.humanReviewStatus === 'passed' && artifact.warningCodes.length === 0) return 'ready';
  return 'blocked_review_required';
};
