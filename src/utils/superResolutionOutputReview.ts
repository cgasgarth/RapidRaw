import type { SuperResolutionNativeReadiness } from '../schemas/computational-merge/superResolutionNativeRegistrationSchemas';
import type {
  SuperResolutionOutputReviewWorkflow,
  SuperResolutionTiledApplyReceipt,
} from '../schemas/computational-merge/superResolutionOutputReviewSchemas';
import { superResolutionOutputReviewWorkflowSchema } from '../schemas/computational-merge/superResolutionOutputReviewSchemas';
import type { SuperResolutionUiSettings } from '../schemas/computational-merge/superResolutionUiSchemas';
import { getSuperResolutionModeForDetailPolicy } from '../schemas/computational-merge/superResolutionUiSchemas';

type SuperResolutionArtifactReviewInput = {
  decisionStatus: 'blocked' | 'downgraded' | 'eligible_for_apply' | 'preview_only';
  detailPolicy: SuperResolutionUiSettings['detailPolicy'];
  measuredReview?: {
    detailGainRatio: number;
    detailReviewRegions: SuperResolutionOutputReviewWorkflow['detailReview']['regions'];
    downscaleReconstructionError: number;
    falseDetailRisk: Exclude<SuperResolutionOutputReviewWorkflow['falseDetailRisk'], 'unknown'>;
    falseDetailRiskScore: number;
  };
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
  sourceImageRefs?: Array<{
    imagePath?: string;
    sourceIndex: number;
  }>;
  sourceState?: Array<{
    contentHash: string;
    graphRevision: string;
    sourceIndex: number;
  }>;
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
  tiledApplyReceipt?: SuperResolutionTiledApplyReceipt;
  validationSummary: {
    alignmentConfidence?: number;
    downscaleReconstructionError?: number;
    expectedDetailGainRatio?: number;
    falseDetailRiskScore?: number;
    falseDetailRisk?: SuperResolutionOutputReviewWorkflow['falseDetailRisk'];
    humanReviewStatus: SuperResolutionOutputReviewWorkflow['humanReviewStatus'];
    overlapCoverageRatio?: number;
    registrationMetrics?: NonNullable<SuperResolutionOutputReviewWorkflow['registrationMetrics']>;
    sourceCount: number;
  };
  warningCodes: SuperResolutionOutputReviewWorkflow['warningCodes'];
};

interface BuildSuperResolutionOutputReviewOptions {
  artifactPath: string;
  settings: SuperResolutionUiSettings;
  sourceCount: number;
  sourcePaths?: string[];
  nativeReadiness?: SuperResolutionNativeReadiness | null;
}

const reviewCropCount = 4;
const reviewPacketPath = 'docs/validation/proofs/super-resolution/sr-synthetic-output-artifact-proof-2026-06-20.json';
const requiredCropReviewArtifactKinds = [
  'baseline_review_crop',
  'crop_review_sheet',
  'reconstruction_review_crop',
] as const satisfies ReadonlyArray<SuperResolutionOutputReviewWorkflow['reviewArtifacts'][number]['kind']>;

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

export const hasSuperResolutionCropReviewEvidence = (review: SuperResolutionOutputReviewWorkflow): boolean => {
  if (review.reviewCropCount <= 0 || review.cropMetrics.reviewCropCount < review.reviewCropCount) return false;

  const artifactKinds = new Set(review.reviewArtifacts.map((artifact) => artifact.kind));
  return requiredCropReviewArtifactKinds.every((kind) => artifactKinds.has(kind));
};

export const hasAcceptedSuperResolutionCropReview = (review: SuperResolutionOutputReviewWorkflow): boolean =>
  review.humanReviewStatus === 'passed' &&
  review.detailReview.reviewStatus === 'accepted' &&
  hasSuperResolutionCropReviewEvidence(review);

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
    downscaleReconstructionError:
      artifactValue.measuredReview?.downscaleReconstructionError ??
      artifactValue.validationSummary.downscaleReconstructionError ??
      null,
    decision: deriveDecision(artifactValue),
    detailGainRatio:
      artifactValue.measuredReview?.detailGainRatio ?? artifactValue.validationSummary.expectedDetailGainRatio ?? null,
    detailPolicy: artifactValue.detailPolicy,
    detailReview: buildDetailReview({
      baselineArtifactId: 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-baseline-crop-center.pgm',
      detailGainRatio:
        artifactValue.measuredReview?.detailGainRatio ??
        artifactValue.validationSummary.expectedDetailGainRatio ??
        null,
      falseDetailRisk:
        artifactValue.measuredReview?.falseDetailRisk ?? artifactValue.validationSummary.falseDetailRisk ?? 'unknown',
      ...(artifactValue.measuredReview?.detailReviewRegions === undefined
        ? {}
        : { measuredRegions: artifactValue.measuredReview.detailReviewRegions }),
      outputArtifactId: artifactValue.outputArtifact.artifactId,
    }),
    editableGate: deriveEditableGate(artifactValue),
    falseDetailRisk:
      artifactValue.measuredReview?.falseDetailRisk ?? artifactValue.validationSummary.falseDetailRisk ?? 'unknown',
    falseDetailRiskScore:
      artifactValue.measuredReview?.falseDetailRiskScore ??
      artifactValue.validationSummary.falseDetailRiskScore ??
      null,
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
    registrationMetrics: artifactValue.validationSummary.registrationMetrics ?? null,
    reviewArtifacts: superResolutionSyntheticReviewArtifacts,
    reviewCropCount,
    reviewPacketPath,
    sourceCount: artifactValue.validationSummary.sourceCount,
    sourceRefs: buildSourceRefsFromArtifact(artifactValue),
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
            ...(artifactValue.supportMap.downgradeReason === undefined
              ? {}
              : { downgradeReason: artifactValue.supportMap.downgradeReason }),
            effectiveScale: artifactValue.supportMap.effectiveScale,
            reviewStatus: artifactValue.supportMap.reviewStatus,
            requestedScale: artifactValue.supportMap.requestedScale,
            weakSupportRatio: artifactValue.supportMap.weakSupportRatio,
            warningCodes: artifactValue.warningCodes,
          }),
    ...(artifactValue.tiledApplyReceipt === undefined ? {} : { tiledApplyReceipt: artifactValue.tiledApplyReceipt }),
    warningCodes: artifactValue.warningCodes,
  });
};

export const buildSuperResolutionOutputReviewWorkflow = ({
  artifactPath,
  settings,
  sourceCount,
  sourcePaths = [],
  nativeReadiness = null,
}: BuildSuperResolutionOutputReviewOptions): SuperResolutionOutputReviewWorkflow => {
  const nativeDecision = nativeReadiness?.reconstruction?.decision;
  const decision =
    nativeDecision === 'blocked'
      ? 'blocked'
      : nativeDecision === 'preview_only' || settings.detailPolicy === 'aggressive_preview_only'
        ? 'preview_only'
        : 'human_review_required';
  const warningCodes: SuperResolutionOutputReviewWorkflow['warningCodes'] =
    settings.detailPolicy === 'aggressive_preview_only'
      ? ['human_review_required', 'synthetic_runtime_only', 'texture_risk', 'aggressive_preview_only']
      : ['human_review_required', 'synthetic_runtime_only', 'texture_risk'];

  const nativeReconstruction = nativeReadiness?.reconstruction ?? null;
  const nativeRegistration = nativeReadiness?.registration ?? null;
  const nativeCoverage =
    nativeReconstruction === null
      ? null
      : nativeReconstruction.planeArtifacts.reduce((sum, plane) => sum + plane.coverageRatio, 0) /
        nativeReconstruction.planeArtifacts.length;
  const nativeWeakSupport =
    nativeReconstruction === null
      ? null
      : nativeReconstruction.planeArtifacts.reduce((sum, plane) => sum + plane.weakSupportRatio, 0) /
        nativeReconstruction.planeArtifacts.length;
  return superResolutionOutputReviewWorkflowSchema.parse({
    alignmentMode: settings.alignmentMode,
    artifactPath,
    alignmentConfidence: null,
    cropMetrics: {
      outputHeight: nativeReconstruction?.height ?? 1,
      outputWidth: nativeReconstruction?.width ?? 1,
      overlapCoverageRatio: nativeCoverage,
      reviewCropCount,
    },
    downscaleReconstructionError: nativeReconstruction?.quality.metrics.downsampleReprojectionMae ?? null,
    decision,
    detailPolicy: settings.detailPolicy,
    detailGainRatio: nativeReconstruction?.quality.metrics.finalMtf50Gain ?? null,
    detailReview: buildDetailReview({
      baselineArtifactId: 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-baseline-crop-center.pgm',
      detailGainRatio: nativeReconstruction?.quality.metrics.finalMtf50Gain ?? null,
      falseDetailRisk:
        nativeReconstruction === null
          ? settings.detailPolicy === 'aggressive_preview_only'
            ? 'high'
            : 'unknown'
          : nativeReconstruction.quality.blockCodes.includes('false_detail_consistency_failed')
            ? 'high'
            : 'low',
      outputArtifactId: artifactPath,
    }),
    editableGate: 'blocked_review_required',
    falseDetailRisk:
      nativeReconstruction === null
        ? settings.detailPolicy === 'aggressive_preview_only'
          ? 'high'
          : 'unknown'
        : nativeReconstruction.quality.blockCodes.includes('false_detail_consistency_failed')
          ? 'high'
          : 'low',
    falseDetailRiskScore: nativeReconstruction?.quality.metrics.falseFrequencyResponse ?? null,
    humanReviewStatus: 'pending',
    mode: getSuperResolutionModeForDetailPolicy(settings.detailPolicy),
    modePolicyVersion: 1,
    outputArtifactHash: nativeReconstruction?.finalPreview.contentHash ?? 'unmeasured:super_resolution_preview',
    outputArtifactId: nativeReconstruction === null ? artifactPath : 'native:super-resolution:cfa-x2-preview',
    outputHeight: nativeReconstruction?.height ?? 1,
    outputScale: settings.outputScale,
    outputWidth: nativeReconstruction?.width ?? 1,
    overlapCoverageRatio: nativeCoverage,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    reconstructionMode: settings.reconstructionMode,
    registrationMetrics:
      nativeRegistration === null
        ? null
        : {
            algorithmId: 'output_lattice_phase_residual_v1',
            averageConfidence: nativeRegistration.summary.confidence,
            averageResidualPx: nativeRegistration.summary.p50ResidualPx,
            maxResidualPx: nativeRegistration.summary.p95ResidualPx,
            measuredSubpixelFrameCount: nativeRegistration.transforms.length,
          },
    reviewArtifacts: superResolutionSyntheticReviewArtifacts,
    reviewCropCount,
    reviewPacketPath,
    sourceCount,
    sourceRefs: buildSourceRefsFromPaths(sourceCount, sourcePaths),
    staleState: 'unknown',
    supportMap: buildSupportMapReview({
      artifactId:
        nativeReconstruction?.planeArtifacts.map((plane) => plane.support.contentHash).join(',') ??
        `${artifactPath}:support-map`,
      coverageRatio: nativeCoverage,
      detailPolicy: settings.detailPolicy,
      effectiveScale: settings.outputScale,
      requestedScale: settings.outputScale,
      ...(nativeWeakSupport === null ? {} : { weakSupportRatio: nativeWeakSupport }),
      warningCodes,
    }),
    warningCodes,
  });
};

const buildSourceRefsFromArtifact = (
  artifact: SuperResolutionArtifactReviewInput,
): SuperResolutionOutputReviewWorkflow['sourceRefs'] => {
  const sourcePathByIndex = new Map<number, string>();
  for (const source of artifact.sourceImageRefs ?? []) {
    if (source.imagePath !== undefined) sourcePathByIndex.set(source.sourceIndex, source.imagePath);
  }
  if (artifact.sourceState !== undefined && artifact.sourceState.length > 0) {
    return artifact.sourceState
      .map((source) => ({
        contentHash: source.contentHash,
        graphRevision: source.graphRevision,
        path: sourcePathByIndex.get(source.sourceIndex),
        sourceIndex: source.sourceIndex,
      }))
      .sort((left, right) => left.sourceIndex - right.sourceIndex);
  }

  return buildSourceRefsFromPaths(artifact.validationSummary.sourceCount, []);
};

const buildSourceRefsFromPaths = (
  sourceCount: number,
  sourcePaths: string[],
): SuperResolutionOutputReviewWorkflow['sourceRefs'] =>
  Array.from({ length: sourceCount }, (_value, sourceIndex) => {
    const path = sourcePaths[sourceIndex];
    return {
      contentHash: hashStableJson({ path: path ?? `sr-source-${sourceIndex}`, sourceIndex }),
      graphRevision: `sr_source_${sourceIndex}`,
      ...(path === undefined ? {} : { path }),
      sourceIndex,
    };
  });

const buildDetailReview = ({
  baselineArtifactId,
  detailGainRatio,
  falseDetailRisk,
  measuredRegions,
  outputArtifactId,
}: {
  baselineArtifactId: string;
  detailGainRatio: number | null;
  falseDetailRisk: SuperResolutionOutputReviewWorkflow['falseDetailRisk'];
  measuredRegions?: SuperResolutionOutputReviewWorkflow['detailReview']['regions'];
  outputArtifactId: string;
}): SuperResolutionOutputReviewWorkflow['detailReview'] => {
  if (measuredRegions !== undefined) {
    const improvementHighlightCount = measuredRegions.filter((region) => region.improvementRatio > 1).length;
    const meanImprovementRatio =
      measuredRegions.length === 0
        ? 1
        : Number(
            (
              measuredRegions.reduce((sum, region) => sum + region.improvementRatio, 0) / measuredRegions.length
            ).toFixed(3),
          );
    const reviewStatus = measuredRegions.some((region) => region.reviewStatus === 'rejected')
      ? 'rejected'
      : measuredRegions.some((region) => region.reviewStatus === 'needs_review')
        ? 'needs_review'
        : 'accepted';

    return {
      artifactId: `${outputArtifactId}:detail-review`,
      baselineArtifactId,
      improvementHighlightCount,
      meanImprovementRatio,
      reconstructedArtifactId: outputArtifactId,
      regions: measuredRegions,
      reviewStatus,
    };
  }

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
  downgradeReason,
  effectiveScale,
  reviewStatus,
  requestedScale,
  weakSupportRatio,
  warningCodes,
}: {
  artifactId: string;
  coverageRatio: number | null;
  detailPolicy: SuperResolutionUiSettings['detailPolicy'];
  downgradeReason?: SuperResolutionOutputReviewWorkflow['supportMap']['downgradeReason'];
  effectiveScale: number;
  reviewStatus?: SuperResolutionOutputReviewWorkflow['supportMap']['reviewStatus'];
  requestedScale: number;
  weakSupportRatio?: number;
  warningCodes: SuperResolutionOutputReviewWorkflow['warningCodes'];
}): SuperResolutionOutputReviewWorkflow['supportMap'] => {
  const resolvedCoverageRatio = coverageRatio ?? (detailPolicy === 'conservative' ? 0.75 : 0.58);
  const resolvedWeakSupportRatio = Number((weakSupportRatio ?? Math.max(0, 1 - resolvedCoverageRatio)).toFixed(3));
  const resolvedDowngradeReason =
    downgradeReason ?? (warningCodes.includes('effective_scale_downgraded') ? 'effective_scale_downgraded' : null);
  const finalReviewStatus =
    reviewStatus ??
    (warningCodes.includes('texture_risk') || resolvedWeakSupportRatio > 0.25 || resolvedDowngradeReason !== null
      ? 'review_required'
      : 'apply_ready');

  return {
    artifactId,
    coverageRatio: Number(resolvedCoverageRatio.toFixed(3)),
    downgradeReason: resolvedDowngradeReason,
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
        risk: resolvedWeakSupportRatio > 0.2 ? 'weak_support' : 'supported',
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
    reviewStatus: finalReviewStatus,
    weakSupportRatio: resolvedWeakSupportRatio,
  };
};

const deriveDecision = (
  artifact: SuperResolutionArtifactReviewInput,
): SuperResolutionOutputReviewWorkflow['decision'] => {
  const maxRegistrationResidualPx = artifact.validationSummary.registrationMetrics?.maxResidualPx ?? 0;
  const falseDetailRisk = artifact.measuredReview?.falseDetailRisk ?? artifact.validationSummary.falseDetailRisk;
  const supportReviewStatus = artifact.supportMap?.reviewStatus;

  if (artifact.decisionStatus === 'preview_only' || artifact.detailPolicy === 'aggressive_preview_only') {
    return 'preview_only';
  }
  if (supportReviewStatus === 'blocked' || maxRegistrationResidualPx > 0.75 || falseDetailRisk === 'high') {
    return 'blocked';
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
