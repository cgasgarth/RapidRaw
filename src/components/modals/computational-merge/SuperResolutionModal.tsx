import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Layers3, ScanSearch, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BurstSrApplyReceipt } from '../../../schemas/computational-merge/burstSrApplySchemas';
import {
  type SingleImageX2ApplyReceipt,
  type SingleImageX2Capability,
  type SingleImageX2Preview,
  singleImageX2CapabilitySchema,
} from '../../../schemas/computational-merge/singleImageX2Schemas';
import type { BurstSrCandidateJobResult } from '../../../schemas/computational-merge/superResolutionCandidateRuntimeSchemas';
import type { SuperResolutionOutputReviewWorkflow } from '../../../schemas/computational-merge/superResolutionOutputReviewSchemas';
import type {
  SuperResolutionAlignmentMode,
  SuperResolutionMode,
  SuperResolutionQualityPreference,
  SuperResolutionReconstructionMode,
  SuperResolutionUiSettings,
} from '../../../schemas/computational-merge/superResolutionUiSchemas';
import {
  getSuperResolutionDetailPolicyForMode,
  getSuperResolutionModeForDetailPolicy,
} from '../../../schemas/computational-merge/superResolutionUiSchemas';
import { type SuperResolutionModalState, useUIStore } from '../../../store/useUIStore';
import { Invokes } from '../../../tauri/commands';
import { TextColors, TextVariants } from '../../../types/typography';
import type { SuperResolutionNativeReadiness } from '../../../utils/superResolutionNativeReadiness';
import {
  buildSuperResolutionOutputReviewWorkflow,
  hasAcceptedSuperResolutionCropReview,
  hasSuperResolutionCropReviewEvidence,
} from '../../../utils/superResolutionOutputReview';
import type { SuperResolutionSourcePreflightMetadata } from '../../../utils/superResolutionSourcePreflight';
import { buildSuperResolutionSourcePreflight } from '../../../utils/superResolutionSourcePreflight';
import { invokeWithSchema } from '../../../utils/tauriSchemaInvoke';
import Button from '../../ui/primitives/Button';
import Dropdown, { type OptionItem } from '../../ui/primitives/Dropdown';
import UiText from '../../ui/primitives/Text';
import ComputationalMergeReviewPanel from './ComputationalMergeReviewPanel';
import {
  ComputationalSetupModalShell,
  ComputationalSetupOptionSection,
  ComputationalSetupSourceWarning,
  ComputationalSetupStatusLine,
} from './ComputationalSetupModalShell';

interface SuperResolutionModalProps {
  applyReceipt?: BurstSrApplyReceipt | null;
  isOpen: boolean;
  lastApplyCommand?: SuperResolutionModalState['lastApplyCommand'];
  lastDryRunCommand?: SuperResolutionModalState['lastDryRunCommand'];
  loadingImageUrl?: string | null;
  onApplyPlan?: () => void;
  onPrepareCandidate?: () => void;
  onCancelCandidate?: () => void;
  candidateJob?: BurstSrCandidateJobResult | null;
  onClose: () => void;
  onOpenOutput?: (path: string) => void;
  onPreviewPlan: () => void;
  onCancelSingleImagePreview?: () => void;
  onApplySingleImage?: () => void;
  reviewArtifactPreviewUrls?: Partial<
    Record<SuperResolutionOutputReviewWorkflow['reviewArtifacts'][number]['kind'], string>
  >;
  onSettingsChange: (settings: SuperResolutionUiSettings) => void;
  outputReview?: SuperResolutionOutputReviewWorkflow | null;
  singleImagePreview?: SingleImageX2Preview | null;
  singleImagePreviewRunning?: boolean;
  singleImageApplyRunning?: boolean;
  singleImageApplyReceipt?: SingleImageX2ApplyReceipt | null;
  nativeReadiness?: SuperResolutionNativeReadiness | null;
  settings: SuperResolutionUiSettings;
  sourceCount: number;
  sourcePaths?: string[];
  sourcePreflightMetadata?: SuperResolutionSourcePreflightMetadata[];
}

const scaleOptions = [1.5, 2, 3, 4] as const;
const previewDimensionOptions = [2400, 4096, 8192] as const;
const getArtifactFileName = (path: string): string => path.split('/').at(-1) ?? path;
const getShortHash = (hash: string): string => `${hash.slice(0, 18)}...`;

export function SuperResolutionModal({
  applyReceipt = null,
  isOpen,
  lastApplyCommand,
  lastDryRunCommand,
  loadingImageUrl,
  onClose,
  onOpenOutput,
  onApplySingleImage,
  onApplyPlan,
  onPrepareCandidate,
  onCancelCandidate,
  candidateJob = null,
  onPreviewPlan,
  onCancelSingleImagePreview,
  reviewArtifactPreviewUrls = {},
  onSettingsChange,
  outputReview: runtimeOutputReview,
  singleImagePreview = null,
  singleImagePreviewRunning = false,
  singleImageApplyRunning = false,
  singleImageApplyReceipt = null,
  nativeReadiness,
  settings,
  sourceCount,
  sourcePaths = [],
  sourcePreflightMetadata = [],
}: SuperResolutionModalProps) {
  const { t } = useTranslation();
  const [singleImageCapability, setSingleImageCapability] = useState<SingleImageX2Capability | null>(null);
  const [acceptedSingleImageReviewHash, setAcceptedSingleImageReviewHash] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    void invokeWithSchema(Invokes.GetSingleImageX2Capability, {}, singleImageX2CapabilitySchema)
      .then(setSingleImageCapability)
      .catch(() => setSingleImageCapability(null));
  }, [isOpen]);

  useEffect(() => {
    setAcceptedSingleImageReviewHash(null);
  }, [singleImagePreview?.review.outputHash]);

  const sourcePreflight = useMemo(
    () =>
      sourcePreflightMetadata.length > 0
        ? buildSuperResolutionSourcePreflight({
            requestedScale: settings.outputScale,
            sources: sourcePreflightMetadata,
          })
        : null,
    [settings.outputScale, sourcePreflightMetadata],
  );
  const isSingleImageAi = settings.sourceMode === 'single_image_ai_x2';
  const canPreviewPlan = isSingleImageAi
    ? sourceCount === 1 && singleImageCapability?.available === true
    : sourceCount >= 2;
  const isSourceCountValid = nativeReadiness?.accepted ?? canPreviewPlan;
  const isSourcePreflightReady = sourcePreflight?.status === 'ready';
  const isSourcePreflightBlocked = sourcePreflight?.status === 'blocked';
  const isSourcePreflightMissingMetadata = sourcePreflight?.status === 'metadata_missing';
  const nativeRegistration = nativeReadiness?.registration ?? null;
  const nativeReconstruction = nativeReadiness?.reconstruction ?? null;
  const isAggressivePreviewOnly = settings.detailPolicy === 'aggressive_preview_only';
  const outputPixelMultiplier = Number((settings.outputScale * settings.outputScale).toFixed(2));
  const estimatedPreviewMegapixels = Math.round((sourceCount * settings.maxPreviewDimensionPx ** 2) / 1_000_000);
  const estimatedPreviewMemoryMb = Math.max(
    0,
    Math.round((sourceCount * settings.maxPreviewDimensionPx ** 2 * 4 * outputPixelMultiplier) / 1_000_000),
  );

  const alignmentOptions: Array<OptionItem<SuperResolutionAlignmentMode>> = [
    { label: t('modals.superResolution.alignmentAuto'), value: 'auto' },
    { label: t('modals.superResolution.alignmentTranslation'), value: 'translation' },
    ...(isSingleImageAi
      ? [
          { label: t('modals.superResolution.alignmentHomography'), value: 'homography' as const },
          { label: t('modals.superResolution.alignmentOpticalFlow'), value: 'optical_flow' as const },
        ]
      : []),
  ];

  const qualityOptions: Array<OptionItem<SuperResolutionQualityPreference>> = [
    { label: t('modals.superResolution.qualityPreview'), value: 'preview' },
    { label: t('modals.superResolution.qualityBalanced'), value: 'balanced' },
    { label: t('modals.superResolution.qualityBest'), value: 'best' },
  ];
  const modeOptions: Array<{ mode: SuperResolutionMode; status: string }> = [
    { mode: 'conservative', status: t('modals.superResolution.mode.conservative.status') },
    { mode: 'standard', status: t('modals.superResolution.mode.standard.status') },
    { mode: 'aggressive', status: t('modals.superResolution.mode.aggressive.status') },
  ];
  const reconstructionModeOptions: Array<{ mode: SuperResolutionReconstructionMode; status: string }> = [
    { mode: 'model_detail', status: t('modals.superResolution.reconstructionMode.model_detail.status') },
    { mode: 'optical_flow', status: t('modals.superResolution.reconstructionMode.optical_flow.status') },
  ];
  const selectedAlignmentLabel =
    alignmentOptions.find((option) => option.value === settings.alignmentMode)?.label ?? '';
  const selectedQualityLabel =
    qualityOptions.find((option) => option.value === settings.qualityPreference)?.label ?? '';
  const selectedMode = getSuperResolutionModeForDetailPolicy(settings.detailPolicy);
  const effectiveScale = sourcePreflight?.validation?.effectiveScale ?? settings.outputScale;
  const validationConfidenceLabel =
    sourcePreflight?.validation === null || sourcePreflight === null
      ? t('modals.superResolution.preflight.notMeasured')
      : t('modals.superResolution.review.confidenceValue', {
          value: Math.round(sourcePreflight.validation.validationConfidence * 100),
        });
  const sourcePreflightStatusLabel = isSourcePreflightReady
    ? t('modals.superResolution.preflight.ready')
    : isSourcePreflightBlocked
      ? t('modals.superResolution.preflight.blocked')
      : isSourcePreflightMissingMetadata
        ? t('modals.superResolution.preflight.metadataMissing', {
            count: sourcePreflight.missingMetadataCount,
          })
        : t('modals.superResolution.preflight.notMeasured');
  const nativeReadinessLabel =
    nativeReadiness === null || nativeReadiness === undefined
      ? null
      : nativeReadiness.accepted
        ? t('modals.superResolution.preflight.ready')
        : t('modals.superResolution.preflight.blocked');
  const sourcePreflightWarningsLabel =
    sourcePreflight?.validation?.warningCodes
      .map((warningCode) => t(`modals.superResolution.preflight.warning.${warningCode}`))
      .join(', ') || t('modals.superResolution.preflight.noWarnings');
  const sourcePreflightBlocksLabel =
    sourcePreflight?.validation?.blockCodes
      .map((blockCode) => t(`modals.superResolution.preflight.block.${blockCode}`))
      .join(', ') || t('modals.superResolution.preflight.noBlocks');
  const sourcePreflightDowngradesLabel =
    sourcePreflight?.validation?.downgradeReasons
      .map((downgradeReason) => t(`modals.superResolution.preflight.downgrade.${downgradeReason}`))
      .join(', ') || t('modals.superResolution.preflight.noDowngrades');
  const sourcePreflightSamples =
    nativeReadiness === null || nativeReadiness === undefined
      ? (sourcePreflight?.validation?.sourceMetadata.slice(0, 4) ?? [])
      : [];
  const sourceReadinessLabel = `${t('modals.superResolution.sourceSummary', { count: sourceCount })} - ${
    isSourceCountValid ? t('modals.superResolution.preflight.ready') : t('modals.superResolution.preflight.blocked')
  }`;
  const reconstructionReadinessLabel = isSourceCountValid
    ? t('modals.superResolution.preflight.ready')
    : t('modals.superResolution.preflight.blocked');
  const fallbackOutputReviewSourceCount = Math.max(2, sourceCount);
  const outputReview =
    runtimeOutputReview ??
    buildSuperResolutionOutputReviewWorkflow({
      artifactPath: sourcePaths[0] ?? '',
      settings,
      sourceCount: fallbackOutputReviewSourceCount,
      sourcePaths,
      nativeReadiness: nativeReadiness ?? null,
    });
  const hasRuntimeOutputReview = runtimeOutputReview !== null && runtimeOutputReview !== undefined;
  const matchingStoredDerivedOutputReceipt = useUIStore((state) =>
    Object.values(state.derivedOutputReceipts).find(
      (receipt) => receipt.family === 'super_resolution' && receipt.outputArtifactId === outputReview.outputArtifactId,
    ),
  );
  const previewPlanStatusLabel = hasRuntimeOutputReview
    ? t('modals.superResolution.previewPlanReady')
    : t('modals.superResolution.previewPlanPending');
  const outputReviewDecisionLabel = t(`modals.superResolution.review.decision.${outputReview.decision}`);
  const outputReviewEditableGateLabel = t(`modals.superResolution.review.editableGate.${outputReview.editableGate}`);
  const detailGainLabel =
    outputReview.detailGainRatio === null
      ? t('modals.superResolution.review.notMeasured')
      : t('modals.superResolution.review.detailGainValue', { ratio: outputReview.detailGainRatio });
  const overlapCoverageLabel =
    outputReview.overlapCoverageRatio === null
      ? t('modals.superResolution.review.notMeasured')
      : t('modals.superResolution.review.coverageValue', {
          value: Math.round(outputReview.overlapCoverageRatio * 100),
        });
  const outputArtifactLabel = hasRuntimeOutputReview
    ? `${outputReview.outputArtifactId} (${outputReview.outputWidth}x${outputReview.outputHeight})`
    : t('modals.superResolution.review.notMeasured');
  const reviewArtifactSummary = outputReview.reviewArtifacts
    .map((artifact) => t(`modals.superResolution.review.artifactKind.${artifact.kind}`))
    .join(', ');
  const reviewArtifactCards = outputReview.reviewArtifacts.map((artifact) => ({
    ...artifact,
    fileName: getArtifactFileName(artifact.path),
    kindLabel: t(`modals.superResolution.review.artifactKind.${artifact.kind}`),
    shortHash: getShortHash(artifact.contentHash),
    storageLabel: artifact.publicRepoAllowed
      ? t('modals.superResolution.review.artifactStorage.public')
      : t('modals.superResolution.review.artifactStorage.private'),
    previewUrl: reviewArtifactPreviewUrls[artifact.kind] ?? null,
  }));
  const outputHashLabel = hasRuntimeOutputReview
    ? outputReview.outputArtifactHash
    : t('modals.superResolution.review.notMeasured');
  const outputReviewWarningsLabel = outputReview.warningCodes
    .map((warningCode) => t(`modals.superResolution.review.warning.${warningCode}`))
    .join(', ');
  const outputReviewModeLabel = t(`modals.superResolution.mode.${outputReview.mode}.label`);
  const outputReviewFalseDetailRiskLabel = t(
    `modals.superResolution.review.falseDetailRiskValue.${outputReview.falseDetailRisk}`,
  );
  const supportMapCoverageLabel = t('modals.superResolution.review.supportMapCoverageValue', {
    value: Math.round(outputReview.supportMap.coverageRatio * 100),
  });
  const supportMapWeakSupportLabel = t('modals.superResolution.review.supportMapCoverageValue', {
    value: Math.round(outputReview.supportMap.weakSupportRatio * 100),
  });
  const supportMapStatusLabel = t(
    `modals.superResolution.review.supportMapStatus.${outputReview.supportMap.reviewStatus}`,
  );
  const supportMapDowngradeLabel =
    outputReview.supportMap.downgradeReason === null
      ? t('modals.superResolution.review.noSupportMapDowngrade')
      : t('modals.superResolution.review.warning.effective_scale_downgraded');
  const detailReviewStatusLabel = t(
    `modals.superResolution.review.detailReviewStatus.${outputReview.detailReview.reviewStatus}`,
  );
  const detailReviewMeanImprovementLabel = t('modals.superResolution.review.detailReviewMeanImprovementValue', {
    ratio: outputReview.detailReview.meanImprovementRatio,
  });
  const detailReviewHighlightCountLabel = t('modals.superResolution.review.detailReviewHighlightCountValue', {
    count: outputReview.detailReview.improvementHighlightCount,
  });
  const sourceContentHashesLabel = outputReview.sourceRefs.map((source) => source.contentHash).join(',');
  const sourceGraphRevisionsLabel = outputReview.sourceRefs.map((source) => source.graphRevision).join(',');
  const sourcePathsLabel = outputReview.sourceRefs.map((source) => source.path ?? '').join(',');
  const outputReviewAlignmentConfidenceLabel =
    outputReview.alignmentConfidence === null
      ? t('modals.superResolution.review.notMeasured')
      : t('modals.superResolution.review.confidenceValue', {
          value: Math.round(outputReview.alignmentConfidence * 100),
        });
  const outputReviewRegistrationLabel =
    outputReview.registrationMetrics === null
      ? outputReviewAlignmentConfidenceLabel
      : `${outputReviewAlignmentConfidenceLabel} / ${outputReview.registrationMetrics.maxResidualPx.toFixed(3)} px max`;
  const outputReviewCropMetricsLabel = t('modals.superResolution.review.cropMetricsValue', {
    reviewCropCount: outputReview.cropMetrics.reviewCropCount,
    coverage:
      outputReview.cropMetrics.overlapCoverageRatio === null
        ? t('modals.superResolution.review.notMeasured')
        : `${Math.round(outputReview.cropMetrics.overlapCoverageRatio * 100)}%`,
  });
  const outputReviewDownscaleReconstructionLabel =
    outputReview.downscaleReconstructionError === null
      ? t('modals.superResolution.review.notMeasured')
      : outputReview.downscaleReconstructionError.toFixed(4);
  const hasCropReviewEvidence = hasSuperResolutionCropReviewEvidence(outputReview);
  const hasAcceptedCropReview = hasAcceptedSuperResolutionCropReview(outputReview);
  const cropReviewEvidenceStatus = hasAcceptedCropReview
    ? 'accepted'
    : hasCropReviewEvidence
      ? 'pending_acceptance'
      : 'missing';
  const isEditableHandoffReady = outputReview.editableGate === 'ready' && hasAcceptedCropReview;
  const openInEditorPath = applyReceipt?.payloadPath ?? '';
  const exportHandoffReady = isEditableHandoffReady && openInEditorPath.length > 0;
  const acceptanceGateStatus = isEditableHandoffReady ? 'ready' : 'review';
  const cropReviewStatus = hasAcceptedCropReview ? 'ready' : hasCropReviewEvidence ? 'review' : 'pending';
  const artifactWarningsStatus = outputReview.warningCodes.length === 0 ? 'ready' : 'pending';

  const setSetting = useCallback(
    (patch: Partial<SuperResolutionUiSettings>) => {
      onSettingsChange({ ...settings, ...patch });
    },
    [onSettingsChange, settings],
  );
  const setReconstructionMode = useCallback(
    (reconstructionMode: SuperResolutionReconstructionMode) => {
      setSetting({
        alignmentMode:
          reconstructionMode === 'optical_flow'
            ? 'optical_flow'
            : settings.alignmentMode === 'optical_flow'
              ? 'auto'
              : settings.alignmentMode,
        reconstructionMode,
      });
    },
    [setSetting, settings.alignmentMode],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <ComputationalSetupModalShell
      appServerFamily="super_resolution"
      appServerStatusLabel={t('editor.ai.connection.ready')}
      Icon={ScanSearch}
      isOpen={isOpen}
      loadingImageUrl={loadingImageUrl}
      onClose={handleClose}
      sourcePreviewAlt={t('modals.common.sourcePreviewAlt')}
      sourceSummary={t('modals.superResolution.sourceSummary', { count: sourceCount })}
      title={t('modals.superResolution.title')}
      titleId="super-resolution-modal-title"
      workflowStatus={t('modals.superResolution.workflowStatus')}
      workflowTitle={t('modals.superResolution.workflowTitle')}
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
            type="button"
          >
            {t('modals.superResolution.close')}
          </button>
          <Button onClick={onPreviewPlan} disabled={!canPreviewPlan} data-testid="sr-preview-plan-button">
            <Layers3 className="w-4 h-4" />
            {hasRuntimeOutputReview
              ? t('modals.superResolution.refreshPreviewPlan')
              : t('modals.superResolution.previewPlan')}
          </Button>
          {isSingleImageAi && singleImagePreviewRunning && onCancelSingleImagePreview !== undefined && (
            <Button onClick={onCancelSingleImagePreview} data-testid="sr-single-image-cancel-button">
              {t('modals.hdr.cancel')}
            </Button>
          )}
          {isSingleImageAi && singleImageApplyRunning && onCancelSingleImagePreview !== undefined && (
            <Button onClick={onCancelSingleImagePreview} data-testid="sr-single-image-apply-cancel-button">
              <X className="w-4 h-4" />
              {t('modals.hdr.cancel')}
            </Button>
          )}
          {isSingleImageAi && onApplySingleImage !== undefined && (
            <Button
              onClick={onApplySingleImage}
              disabled={
                singleImageApplyRunning ||
                singleImageCapability?.available !== true ||
                singleImagePreview?.review.decision !== 'preview_only_manual_review' ||
                acceptedSingleImageReviewHash !== singleImagePreview?.review.outputHash
              }
              data-testid="sr-single-image-apply-button"
            >
              <Sparkles className="w-4 h-4" />
              {t('adjustments.color.workflowRecipes.apply')}
            </Button>
          )}
          {isSingleImageAi && singleImageApplyReceipt !== null && onOpenOutput !== undefined && (
            <Button
              onClick={() => onOpenOutput(singleImageApplyReceipt.payloadPath)}
              data-testid="sr-single-image-open-output-button"
            >
              {t('modals.panorama.openInEditor')}
            </Button>
          )}
          {!isSingleImageAi && candidateJob?.status === 'active' && onCancelCandidate !== undefined && (
            <Button onClick={onCancelCandidate} data-testid="sr-candidate-cancel-button">
              <X className="w-4 h-4" />
              {t('modals.hdr.cancel')}
            </Button>
          )}
          {!isSingleImageAi && onPrepareCandidate !== undefined && applyReceipt === null && (
            <Button
              onClick={onPrepareCandidate}
              disabled={nativeReadiness?.accepted !== true || candidateJob?.status === 'active'}
              data-testid="sr-prepare-candidate-button"
            >
              <Sparkles className="w-4 h-4" />
              {t('modals.focusStack.prepareFullResolution')}
            </Button>
          )}
          {!isSingleImageAi && onApplyPlan !== undefined && applyReceipt === null && (
            <Button
              onClick={onApplyPlan}
              disabled={candidateJob?.status !== 'succeeded' || candidateJob.candidate?.commitReady !== true}
              data-testid="sr-apply-candidate-button"
            >
              <CheckCircle2 className="w-4 h-4" />
              {t('adjustments.color.workflowRecipes.apply')}
            </Button>
          )}
          {!isSingleImageAi && applyReceipt !== null && onOpenOutput !== undefined && (
            <Button onClick={() => onOpenOutput(applyReceipt.payloadPath)} data-testid="sr-open-output-button">
              <CheckCircle2 className="w-4 h-4" />
              {t('modals.panorama.openInEditor')}
            </Button>
          )}
        </>
      }
    >
      <ComputationalSetupOptionSection title="Super-resolution workflow">
        {candidateJob !== null && (
          <div
            className="mb-3"
            data-testid="sr-candidate-runtime"
            data-stage={candidateJob.progress.stage}
            data-status={candidateJob.status}
            data-tile-count={candidateJob.candidate?.tileCount ?? 0}
            data-memory-bytes={candidateJob.candidate?.observedPeakMemoryBytes ?? 0}
          >
            <UiText variant={TextVariants.small}>
              {candidateJob.progress.stage} - {Math.round(candidateJob.progress.fraction * 100)}%
            </UiText>
            {candidateJob.candidate !== null && (
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="block">
                {candidateJob.candidate.capabilityState}
              </UiText>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2" data-testid="sr-source-mode-selector">
          <button
            className={`min-h-16 rounded-md border px-3 py-2 text-left ${
              isSingleImageAi ? 'border-accent bg-accent/15' : 'border-border-color bg-bg-primary'
            }`}
            onClick={() =>
              setSetting({
                alignmentMode: 'auto',
                detailPolicy: 'conservative',
                outputScale: 2,
                reconstructionMode: 'model_detail',
                sourceMode: 'single_image_ai_x2',
              })
            }
            type="button"
          >
            <UiText as="span" variant={TextVariants.label}>
              Single-image AI x2
            </UiText>
            <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              Rendered RGB AI derivative
            </UiText>
          </button>
          <button
            className={`min-h-16 rounded-md border px-3 py-2 text-left ${
              !isSingleImageAi ? 'border-accent bg-accent/15' : 'border-border-color bg-bg-primary'
            }`}
            onClick={() => setSetting({ sourceMode: 'multi_image' })}
            type="button"
          >
            <UiText as="span" variant={TextVariants.label}>
              Burst x2
            </UiText>
            <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              Multi-frame Bayer reconstruction
            </UiText>
          </button>
        </div>
      </ComputationalSetupOptionSection>

      {isSingleImageAi && (
        <section
          className="rounded-md border border-border-color bg-bg-primary p-4"
          data-capability-available={String(singleImageCapability?.available === true)}
          data-testid="sr-single-image-ai-capability"
        >
          <UiText variant={TextVariants.heading}>Enhance x2 (AI)</UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
            2x width and height, 4x pixels. Rendered RGB model-based derivative with manual review.
          </UiText>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <ComputationalSetupStatusLine label="Model" value={singleImageCapability?.modelId ?? 'Checking'} />
            <ComputationalSetupStatusLine
              label="Availability"
              value={singleImageCapability?.available ? 'Ready' : 'Blocked: model weight redistribution unverified'}
            />
            <ComputationalSetupStatusLine
              label="Code license"
              value={singleImageCapability?.codeLicense ?? 'Checking'}
            />
            <ComputationalSetupStatusLine
              label="Apply"
              value={
                singleImageCapability?.available
                  ? 'Available after review'
                  : 'Blocked until a verified model is installed'
              }
            />
          </div>
        </section>
      )}

      {isSingleImageAi && singleImagePreview !== null && (
        <section
          className="rounded-md border border-border-color bg-bg-primary p-4"
          data-review-decision={singleImagePreview.review.decision}
          data-testid="sr-single-image-ai-review"
        >
          <div className="grid grid-cols-2 gap-3">
            <figure className="min-w-0">
              <img
                className="aspect-[4/3] w-full object-contain"
                src={singleImagePreview.bicubicPreviewDataUrl}
                alt={t('modals.common.sourcePreviewAlt')}
              />
              <UiText variant={TextVariants.small} color={TextColors.secondary}>
                Bicubic x2 baseline
              </UiText>
            </figure>
            <figure className="min-w-0">
              <img
                className="aspect-[4/3] w-full object-contain"
                src={singleImagePreview.aiPreviewDataUrl}
                alt={t('modals.common.sourcePreviewAlt')}
              />
              <UiText variant={TextVariants.small} color={TextColors.secondary}>
                Enhance x2 AI preview
              </UiText>
            </figure>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <ComputationalSetupStatusLine
              label="Dimensions"
              value={`${singleImagePreview.width}x${singleImagePreview.height}`}
            />
            <ComputationalSetupStatusLine
              label="Downsample MAE"
              value={singleImagePreview.review.downsampleMae.toFixed(6)}
            />
            <ComputationalSetupStatusLine
              label="Residual mean/max"
              value={`${singleImagePreview.review.meanAbsoluteResidual.toFixed(6)} / ${singleImagePreview.review.maxAbsoluteResidual.toFixed(6)}`}
            />
            <ComputationalSetupStatusLine label="Review" value="Manual review required" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm" data-testid="sr-single-image-review-acceptance">
            <input
              type="checkbox"
              checked={acceptedSingleImageReviewHash === singleImagePreview.review.outputHash}
              disabled={singleImagePreview.review.decision !== 'preview_only_manual_review'}
              onChange={(event) =>
                setAcceptedSingleImageReviewHash(event.target.checked ? singleImagePreview.review.outputHash : null)
              }
            />
            {t('modals.superResolution.review.artifactComparatorLimitation')}
          </label>
        </section>
      )}

      {isSingleImageAi && singleImageApplyReceipt !== null && (
        <section
          className="rounded-md border border-border-color bg-bg-primary p-4"
          data-testid="sr-single-image-output"
        >
          <UiText variant={TextVariants.heading}>Enhanced x2 output</UiText>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <ComputationalSetupStatusLine
              label="Dimensions"
              value={`${singleImageApplyReceipt.width}x${singleImageApplyReceipt.height}`}
            />
            <ComputationalSetupStatusLine
              label="Model hash"
              value={getShortHash(singleImageApplyReceipt.modelSha256)}
            />
            <ComputationalSetupStatusLine
              label="Package"
              value={getArtifactFileName(singleImageApplyReceipt.package.finalPackagePath)}
            />
            <ComputationalSetupStatusLine label="Status" value={singleImageApplyReceipt.package.commitStatus} />
          </div>
        </section>
      )}

      {!isSourceCountValid && (
        <ComputationalSetupSourceWarning>
          {t('modals.superResolution.sourceCountBlocked')}
        </ComputationalSetupSourceWarning>
      )}

      <ComputationalSetupOptionSection title={t('modals.superResolution.scaleLabel')}>
        <div
          className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-sm lg:grid-cols-4"
          data-estimated-preview-memory-mb={estimatedPreviewMemoryMb}
          data-estimated-preview-megapixels={estimatedPreviewMegapixels}
          data-testid="sr-output-scale-summary"
        >
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.sources')}
            value={sourceReadinessLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.scale')}
            value={t('modals.superResolution.scaleValue', { scale: settings.outputScale })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.outputPixels')}
            value={t('modals.superResolution.outputPixelMultiplier', { multiplier: outputPixelMultiplier })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.workload')}
            value={t('modals.superResolution.previewWorkloadValue', { value: estimatedPreviewMegapixels })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.memory')}
            value={t('modals.superResolution.previewMemoryValue', { value: estimatedPreviewMemoryMb })}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {(isSingleImageAi ? scaleOptions : ([2] as const)).map((scale) => (
            <button
              key={scale}
              className={`h-11 rounded-md border text-sm font-semibold transition-colors ${
                settings.outputScale === scale
                  ? 'border-accent bg-accent text-button-text'
                  : 'border-border-color bg-bg-primary text-text-primary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ outputScale: scale });
              }}
              type="button"
            >
              {t('modals.superResolution.scaleValue', { scale })}
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <section
        className="grid grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-2 text-sm lg:grid-cols-3"
        data-alignment-mode={settings.alignmentMode}
        data-detail-policy={settings.detailPolicy}
        data-reconstruction-mode={settings.reconstructionMode}
        data-reconstruction-ready={String(isSourceCountValid)}
        data-source-count={sourceCount}
        data-testid="sr-readiness-summary"
      >
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.preflight.sources')}
          value={t('modals.superResolution.sourceSummary', { count: sourceCount })}
        />
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.preflight.alignment')}
          value={selectedAlignmentLabel}
        />
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.modeLabel')}
          value={t(`modals.superResolution.mode.${selectedMode}.label`)}
        />
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.reconstructionModeLabel')}
          value={t(`modals.superResolution.reconstructionMode.${settings.reconstructionMode}.label`)}
        />
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.workflowTitle')}
          value={reconstructionReadinessLabel}
        />
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.previewPlanStatus')}
          value={previewPlanStatusLabel}
        />
      </section>

      {lastDryRunCommand && (
        <section
          className="grid grid-cols-3 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-3 text-xs"
          data-command-type={lastDryRunCommand.commandType}
          data-dry-run={String(lastDryRunCommand.dryRun)}
          data-source-count={lastDryRunCommand.sources}
          data-testid="sr-dry-run-command-state"
          data-tool-name={lastDryRunCommand.toolName}
        >
          {[
            {
              label: t('modals.superResolution.dryRunCommandTool'),
              value: lastDryRunCommand.toolName,
            },
            {
              label: t('modals.superResolution.dryRunCommandSources'),
              value: t('modals.superResolution.sourceSummary', { count: lastDryRunCommand.sources }),
            },
            {
              label: t('modals.superResolution.dryRunCommandMode'),
              value: t('modals.superResolution.dryRunCommandModeValue'),
            },
          ].map((item) => (
            <div className="rounded border border-border-color bg-bg-primary px-2 py-1.5" key={item.label}>
              <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
                {item.label}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                {item.value}
              </UiText>
            </div>
          ))}
        </section>
      )}

      {lastApplyCommand && (
        <section
          className="grid grid-cols-3 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-3 text-xs"
          data-accepted-dry-run-plan-hash={lastApplyCommand.acceptedDryRunPlanHash}
          data-accepted-dry-run-plan-id={lastApplyCommand.acceptedDryRunPlanId}
          data-command-type={lastApplyCommand.commandType}
          data-dry-run={String(lastApplyCommand.dryRun)}
          data-export-handoff-ready={String(exportHandoffReady)}
          data-open-in-editor-path={openInEditorPath}
          data-source-count={lastApplyCommand.sources}
          data-source-graph-revisions={sourceGraphRevisionsLabel}
          data-testid="sr-apply-command-state"
          data-tool-name={lastApplyCommand.toolName}
        >
          {[
            {
              label: t('modals.superResolution.dryRunCommandTool'),
              value: lastApplyCommand.toolName,
            },
            {
              label: t('modals.superResolution.previewPlanStatus'),
              value: t('modals.superResolution.review.supportMapStatus.apply_ready'),
            },
            {
              label: t('modals.superResolution.review.outputArtifact'),
              value: lastApplyCommand.acceptedDryRunPlanId,
            },
          ].map((item) => (
            <div className="rounded border border-border-color bg-bg-primary px-2 py-1.5" key={item.label}>
              <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
                {item.label}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                {item.value}
              </UiText>
            </div>
          ))}
        </section>
      )}

      <section className="grid grid-cols-2 gap-4">
        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.superResolution.alignmentLabel')}
          </UiText>
          <Dropdown
            options={alignmentOptions}
            value={settings.alignmentMode}
            onChange={(alignmentMode) => {
              setSetting({ alignmentMode });
            }}
          />
        </div>
        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.superResolution.qualityLabel')}
          </UiText>
          <Dropdown
            options={qualityOptions}
            value={settings.qualityPreference}
            onChange={(qualityPreference) => {
              setSetting({ qualityPreference });
            }}
          />
        </div>
      </section>

      <ComputationalSetupOptionSection title={t('modals.superResolution.reconstructionModeLabel')}>
        <div
          className="grid grid-cols-2 gap-2"
          data-alignment-mode={settings.alignmentMode}
          data-reconstruction-mode={settings.reconstructionMode}
          data-testid="sr-reconstruction-mode-selector"
        >
          {reconstructionModeOptions.map(({ mode, status }) => (
            <button
              key={mode}
              className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                settings.reconstructionMode === mode
                  ? 'border-accent bg-accent/15'
                  : 'border-border-color bg-bg-primary hover:bg-card-active'
              }`}
              data-sr-reconstruction-mode={mode}
              disabled={!isSingleImageAi}
              onClick={() => {
                setReconstructionMode(mode);
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t(`modals.superResolution.reconstructionMode.${mode}.label`)}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                {isSingleImageAi ? status : 'Unsupported for Burst x2; native CFA fusion is fixed.'}
              </UiText>
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.superResolution.modeLabel')}>
        <div className="grid grid-cols-3 gap-2">
          {modeOptions.map(({ mode, status }) => (
            <button
              key={mode}
              className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                selectedMode === mode
                  ? 'border-accent bg-accent/15'
                  : 'border-border-color bg-bg-primary hover:bg-card-active'
              }`}
              data-sr-mode={mode}
              onClick={() => {
                setSetting({ detailPolicy: getSuperResolutionDetailPolicyForMode(mode) });
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t(`modals.superResolution.mode.${mode}.label`)}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                {status}
              </UiText>
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.superResolution.previewBudgetLabel')}>
        <div className="grid grid-cols-3 gap-2">
          {previewDimensionOptions.map((maxPreviewDimensionPx) => (
            <button
              key={maxPreviewDimensionPx}
              className={`h-10 rounded-md border text-sm transition-colors ${
                settings.maxPreviewDimensionPx === maxPreviewDimensionPx
                  ? 'border-accent bg-accent/15 text-text-primary'
                  : 'border-border-color bg-bg-primary text-text-secondary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ maxPreviewDimensionPx });
              }}
              type="button"
            >
              {t('modals.superResolution.previewBudgetValue', { value: maxPreviewDimensionPx })}
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-md border border-border-color bg-bg-primary p-4"
        data-effective-scale={effectiveScale}
        data-preflight-status={
          nativeReadiness === undefined || nativeReadiness === null
            ? (sourcePreflight?.status ?? 'not_measured')
            : nativeReadiness.accepted
              ? 'ready'
              : 'blocked'
        }
        data-validation-confidence={sourcePreflight?.validation?.validationConfidence ?? ''}
        data-testid="sr-source-preflight"
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-5 h-5 text-accent" />
          <UiText variant={TextVariants.heading}>{t('modals.superResolution.preflightTitle')}</UiText>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.sources')}
            value={String(sourceCount)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.scale')}
            value={t('modals.superResolution.preflight.effectiveScaleValue', {
              effectiveScale,
              requestedScale: settings.outputScale,
            })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.outputPixels')}
            value={t('modals.superResolution.outputPixelMultiplier', { multiplier: outputPixelMultiplier })}
          />
          <ComputationalSetupStatusLine label={t('modals.superResolution.qualityLabel')} value={selectedQualityLabel} />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.alignment')}
            value={t(`modals.superResolution.alignment.${settings.alignmentMode}`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.detail')}
            value={t(`modals.superResolution.detailPolicy.${settings.detailPolicy}.label`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.workload')}
            value={t('modals.superResolution.previewWorkloadValue', { value: estimatedPreviewMegapixels })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.memory')}
            value={t('modals.superResolution.previewMemoryValue', { value: estimatedPreviewMemoryMb })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.provenance')}
            value={t('modals.superResolution.preflight.required')}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.status')}
            value={nativeReadinessLabel ?? sourcePreflightStatusLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.confidence')}
            value={validationConfidenceLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.warnings')}
            value={sourcePreflightWarningsLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.blocks')}
            value={nativeReadiness?.blockCodes.join(', ') || sourcePreflightBlocksLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.downgrades')}
            value={sourcePreflightDowngradesLabel}
          />
        </div>
        {nativeReadiness !== null && nativeReadiness !== undefined && (
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {nativeReadiness.intake.sources.map((source) => (
              <div
                className="rounded-md border border-border-color bg-card-background p-2 text-xs"
                data-testid="sr-native-readiness-row"
                key={`${source.path}-${source.sourceIndex}`}
              >
                <UiText variant={TextVariants.small} color={TextColors.secondary}>
                  {`${source.sourceIndex + 1}. ${source.cameraMake} ${source.cameraModel}`}
                </UiText>
                <UiText className="truncate">{source.path}</UiText>
                <UiText className="truncate" color={TextColors.secondary}>
                  {source.blockCodes.join(', ') || t('modals.superResolution.preflight.ready')}
                </UiText>
              </div>
            ))}
          </div>
        )}
        {sourcePreflightSamples.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {sourcePreflightSamples.map((source) => (
              <div
                className="rounded-md border border-border-color bg-card-background p-2 text-xs"
                data-testid="sr-source-preflight-row"
                key={`${source.imagePath}-${source.sourceIndex}`}
              >
                <UiText variant={TextVariants.small} color={TextColors.secondary}>
                  {t('modals.superResolution.preflight.sourceRoleValue', {
                    role: t(`modals.superResolution.preflight.shiftRole.${source.resolvedShiftRole}`),
                    sourceIndex: source.sourceIndex + 1,
                  })}
                </UiText>
                <UiText className="truncate">{`${source.width}x${source.height}`}</UiText>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      {nativeReadiness !== null && nativeReadiness !== undefined && nativeRegistration !== null && (
        <section
          className="grid gap-3 rounded-md border border-border-color bg-bg-primary p-4"
          data-registration-algorithm={nativeRegistration.algorithmId}
          data-registration-plan-hash={nativeReadiness.acceptedDryRunPlanHash}
          data-registration-status={nativeReadiness.accepted ? 'accepted' : 'blocked'}
          data-testid="sr-native-registration-preview"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <UiText variant={TextVariants.heading}>Registration</UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                {`${nativeRegistration.selectedSourceIndexes.length}/${nativeReadiness.intake.sourceCount} selected`}
              </UiText>
            </div>
            <UiText variant={TextVariants.small} color={TextColors.secondary}>
              {nativeReadiness.accepted ? 'Accepted' : nativeReadiness.blockCodes.join(', ')}
            </UiText>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
            <img
              alt={t('modals.superResolution.review.artifactPreviewAlt', {
                artifact: t('modals.superResolution.review.registration'),
              })}
              className="aspect-video w-full rounded-md border border-border-color bg-black object-contain"
              data-preview-hash={nativeRegistration.preview.contentHash}
              height={nativeRegistration.preview.height}
              src={nativeRegistration.preview.dataUrl}
              width={nativeRegistration.preview.width}
            />
            <div className="grid content-start gap-2 text-sm">
              <ComputationalSetupStatusLine
                label="Reference"
                value={`Source ${nativeRegistration.referenceSourceIndex + 1}`}
              />
              <ComputationalSetupStatusLine
                label="Confidence"
                value={`${Math.round(nativeRegistration.summary.confidence * 100)}%`}
              />
              <ComputationalSetupStatusLine
                label="Coverage"
                value={`${Math.round(nativeRegistration.summary.coverageRatio * 100)}%`}
              />
              <ComputationalSetupStatusLine
                label="Residual p50 / p95"
                value={`${nativeRegistration.summary.p50ResidualPx.toFixed(3)} / ${nativeRegistration.summary.p95ResidualPx.toFixed(3)} px`}
              />
              <ComputationalSetupStatusLine
                label="x2 phases"
                value={`${nativeRegistration.summary.uniqueX2SamplingPhases}/4`}
              />
            </div>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {nativeRegistration.transforms.map((transform) => (
              <div
                className="rounded-md border border-border-color bg-bg-secondary/70 p-3"
                data-registration-source-index={transform.sourceIndex}
                data-registration-transform={`${transform.translationXPx},${transform.translationYPx},${transform.rotationDegrees}`}
                key={transform.sourceIndex}
              >
                <UiText variant={TextVariants.label}>{`Source ${transform.sourceIndex + 1}`}</UiText>
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                  {`${transform.translationXPx.toFixed(3)}, ${transform.translationYPx.toFixed(3)} px / ${transform.rotationDegrees.toFixed(3)} deg`}
                </UiText>
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                  {`${Math.round(transform.overlapRatio * 100)}% overlap / ${transform.p95ResidualPx.toFixed(3)} px p95`}
                </UiText>
              </div>
            ))}
            {nativeRegistration.excludedSources.map((exclusion) => (
              <div
                className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3"
                data-registration-exclusion={exclusion.code}
                key={`excluded-${exclusion.sourceIndex}`}
              >
                <UiText variant={TextVariants.label}>{`Source ${exclusion.sourceIndex + 1}`}</UiText>
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                  {`${exclusion.code}${
                    exclusion.p95ResidualPx === null ? '' : ` / ${exclusion.p95ResidualPx.toFixed(3)} px p95`
                  }`}
                </UiText>
              </div>
            ))}
          </div>
        </section>
      )}

      {nativeReconstruction !== null && (
        <section
          className="grid gap-3 border border-border-color bg-bg-primary p-4"
          data-capability={nativeReconstruction.capability}
          data-decision={nativeReconstruction.decision}
          data-testid="sr-native-cfa-reconstruction"
        >
          <div className="flex items-center justify-between gap-3">
            <UiText variant={TextVariants.heading}>Native x2 reconstruction</UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary}>
              {`${nativeReconstruction.width} x ${nativeReconstruction.height}`}
            </UiText>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <img
              alt={t('modals.superResolution.review.artifactPreviewAlt', {
                artifact: t('modals.superResolution.review.registration'),
              })}
              className="w-full border border-border-color bg-black object-contain"
              data-preview-hash={nativeReconstruction.preview.contentHash}
              height={nativeReconstruction.preview.height}
              src={nativeReconstruction.preview.dataUrl}
              width={nativeReconstruction.preview.width}
            />
            <img
              alt={t('modals.superResolution.review.artifactPreviewAlt', {
                artifact: t('modals.superResolution.review.registration'),
              })}
              className="w-full border border-border-color bg-black object-contain"
              data-preview-hash={nativeReconstruction.referenceBaseline.contentHash}
              height={nativeReconstruction.referenceBaseline.height}
              src={nativeReconstruction.referenceBaseline.dataUrl}
              width={nativeReconstruction.referenceBaseline.width}
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-2" data-testid="sr-native-motion-quality-overlays">
            <div className="grid gap-1">
              <UiText variant={TextVariants.label}>Motion, support, and fallback</UiText>
              <img
                alt={t('modals.superResolution.review.artifactPreviewAlt', {
                  artifact: t('modals.superResolution.review.sourceSupport'),
                })}
                className="w-full border border-border-color bg-black object-contain"
                data-region-hash={nativeReconstruction.regionArtifact.contentHash}
                height={nativeReconstruction.regionArtifact.height}
                src={nativeReconstruction.regionArtifact.dataUrl}
                width={nativeReconstruction.regionArtifact.width}
              />
              <UiText variant={TextVariants.small} color={TextColors.secondary}>
                {`${Math.round(nativeReconstruction.fallbackRatio * 100)}% reference fallback`}
              </UiText>
            </div>
            <div className="grid gap-1">
              <UiText variant={TextVariants.label}>Bounded sharpening strength</UiText>
              <img
                alt={t('modals.superResolution.review.artifactPreviewAlt', {
                  artifact: t('modals.superResolution.review.detailGain'),
                })}
                className="w-full border border-border-color bg-black object-contain"
                data-sharpening-hash={nativeReconstruction.sharpeningArtifact.contentHash}
                height={nativeReconstruction.sharpeningArtifact.height}
                src={nativeReconstruction.sharpeningArtifact.dataUrl}
                width={nativeReconstruction.sharpeningArtifact.width}
              />
              <UiText variant={TextVariants.small} color={TextColors.secondary}>
                {`${nativeReconstruction.quality.metrics.finalMtf50Gain.toFixed(2)}x final detail / ${(nativeReconstruction.quality.metrics.normalizedOvershoot * 100).toFixed(1)}% overshoot`}
              </UiText>
            </div>
          </div>
          <div
            className="grid gap-2 border-t border-border-color pt-3 sm:grid-cols-2 lg:grid-cols-4"
            data-policy-hash={nativeReconstruction.policyHash}
            data-quality-decision={nativeReconstruction.quality.decision}
            data-testid="sr-native-quality-gates"
          >
            <UiText
              variant={TextVariants.small}
            >{`${nativeReconstruction.quality.metrics.unsharpenedMtf50Gain.toFixed(2)}x unsharpened detail`}</UiText>
            <UiText
              variant={TextVariants.small}
            >{`${nativeReconstruction.quality.metrics.downsampleReprojectionMae.toFixed(4)} reprojection MAE`}</UiText>
            <UiText
              variant={TextVariants.small}
            >{`${nativeReconstruction.quality.metrics.meanDeltaE00.toFixed(2)} DeltaE00`}</UiText>
            <UiText variant={TextVariants.small}>
              {nativeReconstruction.quality.blockCodes.length === 0
                ? 'Objective gates passed'
                : nativeReconstruction.quality.blockCodes.join(', ')}
            </UiText>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {nativeReconstruction.planeArtifacts.map((plane) => (
              <div className="grid gap-1" data-cfa-plane={plane.class} key={plane.class}>
                <UiText variant={TextVariants.label}>{`${plane.class} support`}</UiText>
                <img
                  alt={`${plane.class} measured support`}
                  className="w-full border border-border-color bg-black object-contain"
                  data-support-hash={plane.support.contentHash}
                  height={plane.support.height}
                  src={plane.support.dataUrl}
                  width={plane.support.width}
                />
                <UiText variant={TextVariants.small} color={TextColors.secondary}>
                  {`${Math.round(plane.coverageRatio * 100)}% supported / ${Math.round(plane.weakSupportRatio * 100)}% weak`}
                </UiText>
              </div>
            ))}
          </div>
        </section>
      )}

      <ComputationalMergeReviewPanel
        {...(matchingStoredDerivedOutputReceipt === undefined
          ? {}
          : { derivedOutputReceipt: matchingStoredDerivedOutputReceipt })}
        {...(onOpenOutput === undefined
          ? {}
          : { onExportDerivedOutput: onOpenOutput, onOpenDerivedOutput: onOpenOutput })}
        title={t('modals.superResolution.review.title')}
        proofStatus={t('modals.superResolution.review.proofStatus')}
        limitation={t('modals.superResolution.review.limitation')}
        hidden={!hasRuntimeOutputReview}
        testId="sr-review-diagnostics"
        items={[
          {
            label: t('modals.superResolution.modeLabel'),
            status: outputReview.mode === 'aggressive' ? 'pending' : 'ready',
            value: outputReviewModeLabel,
          },
          {
            label: t('modals.superResolution.review.registration'),
            status: hasRuntimeOutputReview ? 'ready' : 'pending',
            value: hasRuntimeOutputReview ? overlapCoverageLabel : t('modals.superResolution.review.notMeasured'),
          },
          {
            label: t('modals.superResolution.review.acceptanceGate'),
            status: acceptanceGateStatus,
            value: `${outputReviewDecisionLabel} - ${outputReviewEditableGateLabel}`,
          },
          {
            label: t('modals.superResolution.review.sourceSupport'),
            status: outputReview.supportMap.reviewStatus === 'apply_ready' ? 'ready' : 'review',
            value: `${supportMapStatusLabel} - ${supportMapCoverageLabel}`,
          },
          {
            label: t('modals.superResolution.review.detailGain'),
            status: 'review',
            value: detailGainLabel,
          },
          {
            label: t('modals.superResolution.review.cropMetrics'),
            status: cropReviewStatus,
            value: `${outputReviewCropMetricsLabel} - ${cropReviewEvidenceStatus}`,
          },
          {
            label: t('modals.superResolution.review.artifactWarnings'),
            status: artifactWarningsStatus,
            value: outputReviewWarningsLabel || t('modals.superResolution.review.noArtifactWarnings'),
          },
        ]}
        sections={[
          {
            title: t('modals.superResolution.preflightTitle'),
            rows: [
              {
                label: t('modals.superResolution.preflight.sources'),
                value: sourceReadinessLabel,
              },
              {
                label: t('modals.superResolution.preflight.scale'),
                value: t('modals.superResolution.scaleValue', { scale: settings.outputScale }),
              },
              {
                label: t('modals.superResolution.preflight.outputPixels'),
                value: t('modals.superResolution.outputPixelMultiplier', { multiplier: outputPixelMultiplier }),
              },
              {
                label: t('modals.superResolution.preflight.workload'),
                value: t('modals.superResolution.previewWorkloadValue', { value: estimatedPreviewMegapixels }),
              },
              {
                label: t('modals.superResolution.preflight.memory'),
                value: t('modals.superResolution.previewMemoryValue', { value: estimatedPreviewMemoryMb }),
              },
              {
                label: t('modals.superResolution.preflight.alignment'),
                value: t(`modals.superResolution.alignment.${settings.alignmentMode}`),
              },
              {
                label: t('modals.superResolution.qualityLabel'),
                value: selectedQualityLabel,
              },
            ],
          },
          {
            title: t('modals.superResolution.review.title'),
            rows: [
              {
                label: t('modals.superResolution.review.acceptanceGate'),
                value: `${outputReviewDecisionLabel} - ${outputReviewEditableGateLabel}`,
              },
              {
                label: t('modals.superResolution.review.humanReviewStatus'),
                value: t(`modals.superResolution.review.humanReviewStatusValue.${outputReview.humanReviewStatus}`),
              },
              {
                label: t('modals.superResolution.modeLabel'),
                value: t(`modals.superResolution.mode.${selectedMode}.label`),
              },
              {
                label: t('modals.superResolution.review.detailGain'),
                value: detailGainLabel,
              },
              {
                label: t('modals.superResolution.review.detailReview'),
                value: `${detailReviewStatusLabel} - ${detailReviewMeanImprovementLabel}`,
              },
              {
                label: t('modals.superResolution.review.coverage'),
                value: overlapCoverageLabel,
              },
              {
                label: t('modals.superResolution.review.cropMetrics'),
                value: outputReviewCropMetricsLabel,
              },
              {
                label: t('modals.superResolution.review.alignmentConfidence'),
                value: outputReviewRegistrationLabel,
              },
              {
                label: t('modals.superResolution.review.falseDetailRisk'),
                value:
                  outputReview.falseDetailRiskScore === null
                    ? outputReviewFalseDetailRiskLabel
                    : `${outputReviewFalseDetailRiskLabel} - ${Math.round(outputReview.falseDetailRiskScore * 100)}%`,
              },
              {
                label: t('modals.superResolution.review.ringing'),
                value: outputReviewDownscaleReconstructionLabel,
              },
              {
                label: t('modals.superResolution.review.supportMap'),
                value: `${supportMapCoverageLabel} - ${supportMapDowngradeLabel}`,
              },
              {
                label: t('modals.superResolution.review.outputArtifact'),
                value: outputArtifactLabel,
              },
              {
                label: t('modals.superResolution.review.outputHash'),
                value: outputHashLabel,
              },
              {
                label: t('modals.superResolution.review.reviewCrops'),
                value: `${t('modals.superResolution.review.reviewCropValue', {
                  count: outputReview.reviewCropCount,
                })} - ${cropReviewEvidenceStatus} - ${reviewArtifactSummary}`,
              },
              {
                label: t('modals.superResolution.review.reviewPacket'),
                value: outputReview.reviewPacketPath,
              },
              {
                label: t('modals.superResolution.review.provenance'),
                value: outputReview.artifactPath,
              },
              {
                label: t('modals.superResolution.preflight.provenance'),
                value: sourceGraphRevisionsLabel,
              },
              {
                label: t('modals.superResolution.review.artifactWarnings'),
                value: outputReviewWarningsLabel,
              },
            ],
          },
        ]}
      />

      <section
        className="rounded-md border border-border-color bg-bg-primary p-4"
        hidden={!hasRuntimeOutputReview}
        data-baseline-artifact-id={outputReview.detailReview.baselineArtifactId}
        data-detail-review-artifact-id={outputReview.detailReview.artifactId}
        data-detail-review-highlight-count={outputReview.detailReview.improvementHighlightCount}
        data-detail-review-mean-improvement-ratio={outputReview.detailReview.meanImprovementRatio}
        data-detail-review-status={outputReview.detailReview.reviewStatus}
        data-reconstructed-artifact-id={outputReview.detailReview.reconstructedArtifactId}
        data-testid="sr-detail-review"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <UiText variant={TextVariants.heading}>{t('modals.superResolution.review.detailReviewTitle')}</UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              {`${detailReviewMeanImprovementLabel} - ${detailReviewHighlightCountLabel}`}
            </UiText>
          </div>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="shrink-0">
            {detailReviewStatusLabel}
          </UiText>
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          {outputReview.detailReview.regions.map((region) => (
            <div
              className="rounded-md border border-border-color bg-bg-secondary/70 p-3"
              data-baseline-sharpness-score={region.baselineSharpnessScore}
              data-detail-improvement-ratio={region.improvementRatio}
              data-reconstructed-sharpness-score={region.reconstructedSharpnessScore}
              data-region-id={region.regionId}
              data-review-status={region.reviewStatus}
              key={region.regionId}
            >
              <UiText variant={TextVariants.label}>{region.label}</UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                {t(`modals.superResolution.review.detailReviewRegionStatus.${region.reviewStatus}`)} -{' '}
                {t('modals.superResolution.review.detailReviewRegionImprovementValue', {
                  ratio: region.improvementRatio,
                })}
              </UiText>
            </div>
          ))}
        </div>
      </section>

      <section
        className="rounded-md border border-border-color bg-bg-primary p-4"
        hidden={!hasRuntimeOutputReview}
        data-effective-scale={outputReview.supportMap.effectiveScale}
        data-requested-scale={outputReview.supportMap.requestedScale}
        data-review-status={outputReview.supportMap.reviewStatus}
        data-support-artifact-id={outputReview.supportMap.artifactId}
        data-support-coverage-ratio={outputReview.supportMap.coverageRatio}
        data-support-downgrade-reason={outputReview.supportMap.downgradeReason ?? ''}
        data-testid="sr-support-map-review"
        data-weak-support-ratio={outputReview.supportMap.weakSupportRatio}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <UiText variant={TextVariants.heading}>{t('modals.superResolution.review.supportMapTitle')}</UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              {t('modals.superResolution.review.supportMapSummary', {
                coverage: Math.round(outputReview.supportMap.coverageRatio * 100),
                weak: Math.round(outputReview.supportMap.weakSupportRatio * 100),
              })}
            </UiText>
          </div>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="shrink-0">
            {supportMapStatusLabel}
          </UiText>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.review.supportMapCoverage')}
            value={supportMapCoverageLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.review.supportMapWeak')}
            value={supportMapWeakSupportLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.scale')}
            value={t('modals.superResolution.preflight.effectiveScaleValue', {
              effectiveScale: outputReview.supportMap.effectiveScale,
              requestedScale: outputReview.supportMap.requestedScale,
            })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.downgrades')}
            value={supportMapDowngradeLabel}
          />
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          {outputReview.supportMap.regions.map((region) => (
            <div
              className="rounded-md border border-border-color bg-bg-secondary/70 p-3"
              data-region-coverage-ratio={region.coverageRatio}
              data-region-id={region.regionId}
              data-region-risk={region.risk}
              key={region.regionId}
            >
              <UiText variant={TextVariants.label}>{region.label}</UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                {t(`modals.superResolution.review.supportMapRisk.${region.risk}`)} -{' '}
                {t('modals.superResolution.review.supportMapCoverageValue', {
                  value: Math.round(region.coverageRatio * 100),
                })}
              </UiText>
            </div>
          ))}
        </div>
      </section>

      <section
        className="rounded-md border border-border-color bg-bg-primary p-4"
        hidden={!hasRuntimeOutputReview}
        data-artifact-count={reviewArtifactCards.length}
        data-testid="sr-review-artifact-comparator"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <UiText variant={TextVariants.heading}>{t('modals.superResolution.review.artifactComparatorTitle')}</UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="shrink-0">
            {t('modals.superResolution.review.proofStatus')}
          </UiText>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {reviewArtifactCards.map((artifact) => (
            <div
              key={artifact.kind}
              className="min-w-0 rounded-md border border-border-color bg-bg-secondary/70 p-3"
              data-review-artifact-hash={artifact.contentHash}
              data-review-artifact-kind={artifact.kind}
              data-review-artifact-path={artifact.path}
              data-review-artifact-public={String(artifact.publicRepoAllowed)}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <UiText as="span" variant={TextVariants.label} className="min-w-0">
                  {artifact.kindLabel}
                </UiText>
                <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="shrink-0">
                  {artifact.storageLabel}
                </UiText>
              </div>
              <div className="grid gap-1 text-sm">
                <div
                  className="grid aspect-[4/3] place-items-center overflow-hidden rounded border border-border-color bg-bg-primary"
                  data-preview-ready={String(artifact.previewUrl !== null)}
                >
                  {artifact.previewUrl === null ? (
                    <UiText variant={TextVariants.small} color={TextColors.secondary}>
                      {t('modals.superResolution.review.artifactPreviewUnavailable')}
                    </UiText>
                  ) : (
                    <img
                      alt={t('modals.superResolution.review.artifactPreviewAlt', { artifact: artifact.kindLabel })}
                      className="h-full w-full object-contain"
                      src={artifact.previewUrl}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block">
                    {t('modals.superResolution.review.artifactFile')}
                  </UiText>
                  <UiText as="span" variant={TextVariants.small} className="block truncate">
                    {artifact.fileName}
                  </UiText>
                </div>
                <div className="min-w-0">
                  <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block">
                    {t('modals.superResolution.review.artifactHash')}
                  </UiText>
                  <UiText as="span" variant={TextVariants.small} className="block font-mono">
                    {artifact.shortHash}
                  </UiText>
                </div>
              </div>
            </div>
          ))}
        </div>
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-3 block leading-relaxed">
          {t('modals.superResolution.review.artifactComparatorLimitation')}
        </UiText>
      </section>

      <div
        className="sr-only"
        hidden={!hasRuntimeOutputReview}
        data-alignment-confidence={outputReview.alignmentConfidence ?? 'not_measured'}
        data-crop-metrics={`${outputReview.cropMetrics.reviewCropCount}:${outputReview.cropMetrics.overlapCoverageRatio ?? 'not_measured'}`}
        data-crop-review-evidence={cropReviewEvidenceStatus}
        data-editable-handoff-ready={String(isEditableHandoffReady)}
        data-export-handoff-ready={String(exportHandoffReady)}
        data-false-detail-risk={outputReview.falseDetailRisk}
        data-false-detail-risk-score={outputReview.falseDetailRiskScore ?? 'not_measured'}
        data-human-review-status={outputReview.humanReviewStatus}
        data-downscale-reconstruction-error={outputReview.downscaleReconstructionError ?? 'not_measured'}
        data-detail-review-highlight-count={outputReview.detailReview.improvementHighlightCount}
        data-detail-review-mean-improvement-ratio={outputReview.detailReview.meanImprovementRatio}
        data-detail-review-status={outputReview.detailReview.reviewStatus}
        data-mode={outputReview.mode}
        data-mode-policy-version={outputReview.modePolicyVersion}
        data-output-artifact-id={outputReview.outputArtifactId}
        data-output-artifact-hash={outputReview.outputArtifactHash}
        data-open-in-editor-path={openInEditorPath}
        data-review-artifact-count={outputReview.reviewArtifacts.length}
        data-review-artifact-hashes={outputReview.reviewArtifacts.map((artifact) => artifact.contentHash).join(',')}
        data-review-artifact-paths={outputReview.reviewArtifacts.map((artifact) => artifact.path).join(',')}
        data-registration-max-residual-px={outputReview.registrationMetrics?.maxResidualPx ?? 'not_measured'}
        data-source-content-hashes={sourceContentHashesLabel}
        data-source-graph-revisions={sourceGraphRevisionsLabel}
        data-source-paths={sourcePathsLabel}
        data-stale-state={outputReview.staleState}
        data-support-map-artifact-id={outputReview.supportMap.artifactId}
        data-support-map-review-status={outputReview.supportMap.reviewStatus}
        data-support-map-weak-ratio={outputReview.supportMap.weakSupportRatio}
        data-testid="sr-editable-handoff-proof"
      />

      {isAggressivePreviewOnly && hasRuntimeOutputReview && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <UiText className="leading-relaxed">{t('modals.superResolution.aggressiveNotice')}</UiText>
        </div>
      )}

      <div
        className="rounded-md border border-border-color bg-bg-primary px-4 py-3 flex gap-3"
        hidden={!hasRuntimeOutputReview}
      >
        <CheckCircle2 className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
        <UiText className="leading-relaxed">{t('modals.superResolution.planDependency')}</UiText>
      </div>
    </ComputationalSetupModalShell>
  );
}

export default SuperResolutionModal;
