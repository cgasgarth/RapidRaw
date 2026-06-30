import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Layers3, ScanSearch, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SuperResolutionOutputReviewWorkflow } from '../../schemas/superResolutionOutputReviewSchemas';
import type {
  SuperResolutionAlignmentMode,
  SuperResolutionMode,
  SuperResolutionQualityPreference,
  SuperResolutionReconstructionMode,
  SuperResolutionUiSettings,
} from '../../schemas/superResolutionUiSchemas';
import {
  getSuperResolutionDetailPolicyForMode,
  getSuperResolutionModeForDetailPolicy,
} from '../../schemas/superResolutionUiSchemas';
import { type SuperResolutionModalState, useUIStore } from '../../store/useUIStore';
import { TextColors, TextVariants } from '../../types/typography';
import {
  buildSuperResolutionDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
} from '../../utils/derivedOutputReceipt';
import { buildSuperResolutionOutputReviewWorkflow } from '../../utils/superResolutionOutputReview';
import type { SuperResolutionSourcePreflightMetadata } from '../../utils/superResolutionSourcePreflight';
import { buildSuperResolutionSourcePreflight } from '../../utils/superResolutionSourcePreflight';
import Button from '../ui/Button';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import UiText from '../ui/Text';
import ComputationalMergeReviewPanel from './ComputationalMergeReviewPanel';
import {
  ComputationalSetupModalShell,
  ComputationalSetupOptionSection,
  ComputationalSetupSourceWarning,
  ComputationalSetupStatusLine,
} from './ComputationalSetupModalShell';

interface SuperResolutionModalProps {
  isOpen: boolean;
  lastApplyCommand?: SuperResolutionModalState['lastApplyCommand'];
  lastDryRunCommand?: SuperResolutionModalState['lastDryRunCommand'];
  loadingImageUrl?: string | null;
  onApplyPlan: () => void;
  onClose: () => void;
  onOpenOutput?: (path: string) => void;
  onPreviewPlan: () => void;
  reviewArtifactPreviewUrls?: Partial<
    Record<SuperResolutionOutputReviewWorkflow['reviewArtifacts'][number]['kind'], string>
  >;
  onSettingsChange: (settings: SuperResolutionUiSettings) => void;
  outputReview?: SuperResolutionOutputReviewWorkflow | null;
  settings: SuperResolutionUiSettings;
  sourceCount: number;
  sourcePaths?: string[];
  sourcePreflightMetadata?: SuperResolutionSourcePreflightMetadata[];
}

const scaleOptions = [1.5, 2, 3, 4] as const;
const previewDimensionOptions = [2400, 4096, 8192] as const;
const reviewArtifactPath = '/tmp/rawengine-super-resolution-smoke.tif';
const getArtifactFileName = (path: string): string => path.split('/').at(-1) ?? path;
const getShortHash = (hash: string): string => `${hash.slice(0, 18)}...`;

export default function SuperResolutionModal({
  isOpen,
  lastApplyCommand,
  lastDryRunCommand,
  loadingImageUrl,
  onApplyPlan,
  onClose,
  onOpenOutput,
  onPreviewPlan,
  reviewArtifactPreviewUrls = {},
  onSettingsChange,
  outputReview: runtimeOutputReview,
  settings,
  sourceCount,
  sourcePaths = [],
  sourcePreflightMetadata = [],
}: SuperResolutionModalProps) {
  const { t } = useTranslation();

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
  const isSourceCountValid = sourceCount >= 2 && sourcePreflight?.status !== 'blocked';
  const isSourcePreflightReady = sourcePreflight?.status === 'ready';
  const isSourcePreflightBlocked = sourcePreflight?.status === 'blocked';
  const isSourcePreflightMissingMetadata = sourcePreflight?.status === 'metadata_missing';
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
    { label: t('modals.superResolution.alignmentHomography'), value: 'homography' },
    { label: t('modals.superResolution.alignmentOpticalFlow'), value: 'optical_flow' },
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
  const sourcePreflightSamples = sourcePreflight?.validation?.sourceMetadata.slice(0, 4) ?? [];
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
      artifactPath: reviewArtifactPath,
      settings,
      sourceCount: fallbackOutputReviewSourceCount,
      sourcePaths,
    });
  const hasRuntimeOutputReview = runtimeOutputReview !== null && runtimeOutputReview !== undefined;
  const derivedOutputReceipt = buildSuperResolutionDerivedOutputReceipt({
    acceptedDryRunPlanHash: lastApplyCommand?.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: lastApplyCommand?.acceptedDryRunPlanId,
    review: outputReview,
    settings,
  });
  const matchingStoredDerivedOutputReceipt = useUIStore((state) =>
    Object.values(state.derivedOutputReceipts).find(
      (receipt) =>
        receipt.family === derivedOutputReceipt.family &&
        receipt.outputArtifactId === derivedOutputReceipt.outputArtifactId,
    ),
  );
  const storedDerivedOutputReceipt = matchingStoredDerivedOutputReceipt ?? derivedOutputReceipt;
  const visibleDerivedOutputReceipt = deriveDerivedOutputReceiptState({
    current: derivedOutputReceipt,
    receipt: storedDerivedOutputReceipt,
  });
  const upsertDerivedOutputReceipt = useUIStore((state) => state.upsertDerivedOutputReceipt);

  useEffect(() => {
    if (matchingStoredDerivedOutputReceipt === undefined) upsertDerivedOutputReceipt(derivedOutputReceipt);
  }, [derivedOutputReceipt, matchingStoredDerivedOutputReceipt, upsertDerivedOutputReceipt]);
  const isApplyPlanReady =
    isSourceCountValid &&
    hasRuntimeOutputReview &&
    outputReview.decision !== 'preview_only' &&
    outputReview.editableGate !== 'blocked_stale';
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
  const outputReviewCropMetricsLabel = t('modals.superResolution.review.cropMetricsValue', {
    reviewCropCount: outputReview.cropMetrics.reviewCropCount,
    coverage:
      outputReview.cropMetrics.overlapCoverageRatio === null
        ? t('modals.superResolution.review.notMeasured')
        : `${Math.round(outputReview.cropMetrics.overlapCoverageRatio * 100)}%`,
  });
  const isEditableHandoffReady = outputReview.editableGate === 'ready';
  const openInEditorPath = derivedOutputReceipt.openInEditorAction.path ?? '';
  const exportHandoffReady = isEditableHandoffReady && openInEditorPath.length > 0;
  const acceptanceGateStatus = isEditableHandoffReady ? 'ready' : 'review';
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
          <Button onClick={onPreviewPlan} disabled={!isSourceCountValid}>
            <Layers3 className="w-4 h-4" />
            {hasRuntimeOutputReview
              ? t('modals.superResolution.refreshPreviewPlan')
              : t('modals.superResolution.previewPlan')}
          </Button>
          <Button onClick={onApplyPlan} disabled={!isApplyPlanReady}>
            <CheckCircle2 className="w-4 h-4" />
            {t('modals.transform.apply')}
          </Button>
        </>
      }
    >
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
          {scaleOptions.map((scale) => (
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
              onClick={() => {
                setReconstructionMode(mode);
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t(`modals.superResolution.reconstructionMode.${mode}.label`)}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                {status}
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
        data-preflight-status={sourcePreflight?.status ?? 'not_measured'}
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
            value={sourcePreflightStatusLabel}
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
            value={sourcePreflightBlocksLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.downgrades')}
            value={sourcePreflightDowngradesLabel}
          />
        </div>
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

      <ComputationalMergeReviewPanel
        derivedOutputReceipt={visibleDerivedOutputReceipt}
        {...(onOpenOutput === undefined
          ? {}
          : { onExportDerivedOutput: onOpenOutput, onOpenDerivedOutput: onOpenOutput })}
        title={t('modals.superResolution.review.title')}
        proofStatus={t('modals.superResolution.review.proofStatus')}
        limitation={t('modals.superResolution.review.limitation')}
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
            status: hasRuntimeOutputReview ? 'ready' : 'pending',
            value: outputReviewCropMetricsLabel,
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
                value: outputReviewAlignmentConfidenceLabel,
              },
              {
                label: t('modals.superResolution.review.falseDetailRisk'),
                value: outputReviewFalseDetailRiskLabel,
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
                })} - ${reviewArtifactSummary}`,
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
        data-alignment-confidence={outputReview.alignmentConfidence ?? 'not_measured'}
        data-crop-metrics={`${outputReview.cropMetrics.reviewCropCount}:${outputReview.cropMetrics.overlapCoverageRatio ?? 'not_measured'}`}
        data-editable-handoff-ready={String(isEditableHandoffReady)}
        data-export-handoff-ready={String(exportHandoffReady)}
        data-false-detail-risk={outputReview.falseDetailRisk}
        data-human-review-status={outputReview.humanReviewStatus}
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
        data-source-content-hashes={sourceContentHashesLabel}
        data-source-graph-revisions={sourceGraphRevisionsLabel}
        data-source-paths={sourcePathsLabel}
        data-stale-state={outputReview.staleState}
        data-support-map-artifact-id={outputReview.supportMap.artifactId}
        data-support-map-review-status={outputReview.supportMap.reviewStatus}
        data-support-map-weak-ratio={outputReview.supportMap.weakSupportRatio}
        data-testid="sr-editable-handoff-proof"
      />

      {isAggressivePreviewOnly && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <UiText className="leading-relaxed">{t('modals.superResolution.aggressiveNotice')}</UiText>
        </div>
      )}

      <div className="rounded-md border border-border-color bg-bg-primary px-4 py-3 flex gap-3">
        <CheckCircle2 className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
        <UiText className="leading-relaxed">{t('modals.superResolution.planDependency')}</UiText>
      </div>
    </ComputationalSetupModalShell>
  );
}
