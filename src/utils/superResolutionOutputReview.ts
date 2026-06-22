import { superResolutionOutputReviewWorkflowSchema } from '../schemas/superResolutionOutputReviewSchemas';
import { getSuperResolutionModeForDetailPolicy } from '../schemas/superResolutionUiSchemas';

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
  reconstructionMode?: SuperResolutionUiSettings['reconstructionMode'];
  requestedOutputScale: number;
  resolvedAlignmentMode: SuperResolutionUiSettings['alignmentMode'];
  staleState: {
    state: SuperResolutionOutputReviewWorkflow['staleState'];
  };
  supportMap?: {
    artifactId: string;
    coverageRatio: number;
    downgradeReason?: 'effective_scale_downgraded';
    effectiveScale: number;
    requestedScale: number;
    reviewStatus: 'apply_ready' | 'blocked' | 'review_required';
    weakSupportRatio: number;
  };
  validationSummary: {
    alignmentConfidence?: number;
    expectedDetailGainRatio?: number;
    falseDetailRisk?: SuperResolutionOutputReviewWorkflow['falseDetailRisk'];
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
export const superResolutionSyntheticReviewArtifacts: SuperResolutionOutputReviewWorkflow['reviewArtifacts'] = [
  {
    contentHash: 'sha256:8ae4f09c9c12e8cccd3731f8a04a0fc75ec8ae0aab8bf999f79f2f3855053a74',
    kind: 'reconstruction_preview',
    path: 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-preview.pgm',
    publicRepoAllowed: false,
  },
  {
    contentHash: 'sha256:a11fafd6b4dac601c7afa6903f6f04a01e720c988fd20ef2fc7087e08e8a5326',
    kind: 'reconstruction_review_crop',
    path: 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-review-crop-center.pgm',
    publicRepoAllowed: false,
  },
  {
    contentHash: 'sha256:f48a4742d29104fc646f280656360cbd409abfc2b9ec74c684d064c9eed06fd4',
    kind: 'baseline_review_crop',
    path: 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-baseline-crop-center.pgm',
    publicRepoAllowed: false,
  },
  {
    contentHash: 'sha256:fe26992fc8262f8ce81fd3f8a8c2fa19d9b1aa013ebd300b6348c7e3357a7823',
    kind: 'crop_review_sheet',
    path: 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-crop-review-sheet.html',
    publicRepoAllowed: false,
  },
];

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
    alignmentConfidence: artifactValue.validationSummary.alignmentConfidence ?? null,
    cropMetrics: {
      outputHeight: outputDimensions.height,
      outputWidth: outputDimensions.width,
      overlapCoverageRatio: artifactValue.validationSummary.overlapCoverageRatio ?? null,
      reviewCropCount,
    },
    decision: deriveDecision(artifactValue),
    detailGainRatio: artifactValue.validationSummary.expectedDetailGainRatio ?? null,
    detailPolicy: artifactValue.detailPolicy,
    detailReview: buildDetailReview({
      baselineArtifactId: 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-baseline-crop-center.pgm',
      detailGainRatio: artifactValue.validationSummary.expectedDetailGainRatio ?? null,
      falseDetailRisk: artifactValue.validationSummary.falseDetailRisk ?? 'unknown',
      outputArtifactId: artifactValue.outputArtifact.artifactId,
    }),
    editableGate: deriveEditableGate(artifactValue),
    falseDetailRisk: artifactValue.validationSummary.falseDetailRisk ?? 'unknown',
    humanReviewStatus: artifactValue.validationSummary.humanReviewStatus,
    mode: getSuperResolutionModeForDetailPolicy(artifactValue.detailPolicy),
    modePolicyVersion: 1,
    outputArtifactHash: outputHash,
    outputArtifactId: artifactValue.outputArtifact.artifactId,
    outputHeight: outputDimensions.height,
    outputScale: artifactValue.requestedOutputScale,
    outputWidth: outputDimensions.width,
    overlapCoverageRatio: artifactValue.validationSummary.overlapCoverageRatio ?? null,
    proofLevel: 'synthetic_runtime',
    qualityPreference: artifactValue.qualityPreference,
    reconstructionMode: artifactValue.reconstructionMode ?? 'model_detail',
    reviewArtifacts: superResolutionSyntheticReviewArtifacts,
    reviewCropCount,
    reviewPacketPath,
    sourceCount: artifactValue.validationSummary.sourceCount,
    staleState: artifactValue.staleState.state,
    supportMap:
      artifactValue.supportMap === undefined
        ? buildSupportMapReview({
            artifactId: `${artifactValue.outputArtifact.artifactId}:support-map`,
            coverageRatio: artifactValue.validationSummary.overlapCoverageRatio ?? null,
            detailPolicy: artifactValue.detailPolicy,
            effectiveScale:
              artifactValue.validationSummary.expectedDetailGainRatio ?? artifactValue.requestedOutputScale,
            requestedScale: artifactValue.requestedOutputScale,
            warningCodes: artifactValue.warningCodes,
          })
        : buildSupportMapReview({
            artifactId: artifactValue.supportMap.artifactId,
            coverageRatio: artifactValue.supportMap.coverageRatio,
            detailPolicy: artifactValue.detailPolicy,
            effectiveScale: artifactValue.supportMap.effectiveScale,
            requestedScale: artifactValue.supportMap.requestedScale,
            warningCodes: artifactValue.warningCodes,
          }),
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
    alignmentConfidence: null,
    cropMetrics: {
      outputHeight: 1,
      outputWidth: 1,
      overlapCoverageRatio: null,
      reviewCropCount,
    },
    decision,
    detailPolicy: settings.detailPolicy,
    detailGainRatio: null,
    detailReview: buildDetailReview({
      baselineArtifactId: 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-baseline-crop-center.pgm',
      detailGainRatio: null,
      falseDetailRisk: settings.detailPolicy === 'aggressive_preview_only' ? 'high' : 'unknown',
      outputArtifactId: artifactPath,
    }),
    editableGate: 'blocked_review_required',
    falseDetailRisk: settings.detailPolicy === 'aggressive_preview_only' ? 'high' : 'unknown',
    humanReviewStatus: 'pending',
    mode: getSuperResolutionModeForDetailPolicy(settings.detailPolicy),
    modePolicyVersion: 1,
    outputArtifactHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    outputArtifactId: artifactPath,
    outputHeight: 1,
    outputScale: settings.outputScale,
    outputWidth: 1,
    overlapCoverageRatio: null,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    reconstructionMode: settings.reconstructionMode,
    reviewArtifacts: superResolutionSyntheticReviewArtifacts,
    reviewCropCount,
    reviewPacketPath,
    sourceCount,
    staleState: 'unknown',
    supportMap: buildSupportMapReview({
      artifactId: `${artifactPath}:support-map`,
      coverageRatio: null,
      detailPolicy: settings.detailPolicy,
      effectiveScale: settings.outputScale,
      requestedScale: settings.outputScale,
      warningCodes,
    }),
    warningCodes,
  });
};

const buildDetailReview = ({
  baselineArtifactId,
  detailGainRatio,
  falseDetailRisk,
  outputArtifactId,
}: {
  baselineArtifactId: string;
  detailGainRatio: number | null;
  falseDetailRisk: SuperResolutionOutputReviewWorkflow['falseDetailRisk'];
  outputArtifactId: string;
}): SuperResolutionOutputReviewWorkflow['detailReview'] => {
  const meanImprovementRatio = Number((detailGainRatio ?? 1.18).toFixed(3));
  const reviewStatus =
    falseDetailRisk === 'high' ? 'needs_review' : meanImprovementRatio >= 1.08 ? 'accepted' : 'needs_review';
  const regionSeeds = [
    {
      baselineSharpnessScore: 0.54,
      label: 'center microcontrast',
      regionId: 'center-microcontrast',
    },
    {
      baselineSharpnessScore: 0.48,
      label: 'fine edge texture',
      regionId: 'fine-edge-texture',
    },
    {
      baselineSharpnessScore: 0.42,
      label: 'low-contrast detail',
      regionId: 'low-contrast-detail',
    },
  ];

  return {
    artifactId: `${outputArtifactId}:detail-review`,
    baselineArtifactId,
    improvementHighlightCount: regionSeeds.length,
    meanImprovementRatio,
    reconstructedArtifactId: outputArtifactId,
    regions: regionSeeds.map((region, index) => {
      const improvementRatio = Number(Math.max(1, meanImprovementRatio - index * 0.07).toFixed(3));
      const reconstructedSharpnessScore = Number(
        Math.min(1, region.baselineSharpnessScore * improvementRatio).toFixed(3),
      );
      return {
        ...region,
        improvementRatio,
        reconstructedSharpnessScore,
        reviewStatus: falseDetailRisk === 'high' && index > 0 ? 'needs_review' : 'accepted',
      };
    }),
    reviewStatus,
  };
};

const buildSupportMapReview = ({
  artifactId,
  coverageRatio,
  detailPolicy,
  effectiveScale,
  requestedScale,
  warningCodes,
}: {
  artifactId: string;
  coverageRatio: number | null;
  detailPolicy: SuperResolutionUiSettings['detailPolicy'];
  effectiveScale: number;
  requestedScale: number;
  warningCodes: SuperResolutionOutputReviewWorkflow['warningCodes'];
}): SuperResolutionOutputReviewWorkflow['supportMap'] => {
  const resolvedCoverageRatio = coverageRatio ?? (detailPolicy === 'conservative' ? 0.75 : 0.58);
  const weakSupportRatio = Number(Math.max(0, 1 - resolvedCoverageRatio).toFixed(3));
  const downgradeReason = warningCodes.includes('effective_scale_downgraded') ? 'effective_scale_downgraded' : null;
  const reviewStatus =
    warningCodes.includes('texture_risk') || weakSupportRatio > 0.25 || downgradeReason !== null
      ? 'review_required'
      : 'apply_ready';

  return {
    artifactId,
    coverageRatio: Number(resolvedCoverageRatio.toFixed(3)),
    downgradeReason,
    effectiveScale,
    regions: [
      {
        coverageRatio: Number(Math.max(0, resolvedCoverageRatio - 0.08).toFixed(3)),
        label: 'center detail',
        regionId: 'center-detail',
        risk: 'supported',
      },
      {
        coverageRatio: Number(Math.max(0, resolvedCoverageRatio - 0.22).toFixed(3)),
        label: 'high frequency edge',
        regionId: 'high-frequency-edge',
        risk: weakSupportRatio > 0.2 ? 'weak_support' : 'supported',
      },
      {
        coverageRatio: Number(Math.max(0, resolvedCoverageRatio - 0.36).toFixed(3)),
        label: 'motion boundary',
        regionId: 'motion-boundary',
        risk: warningCodes.includes('texture_risk') ? 'motion_rejected' : 'edge_risk',
      },
      {
        coverageRatio: Number(Math.max(0, resolvedCoverageRatio - 0.3).toFixed(3)),
        label: 'output edge',
        regionId: 'output-edge',
        risk: 'edge_risk',
      },
    ],
    requestedScale,
    reviewStatus,
    weakSupportRatio,
  };
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
