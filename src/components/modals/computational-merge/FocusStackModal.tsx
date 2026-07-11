import { motion } from 'framer-motion';
import { AlertTriangle, Aperture, CheckCircle2, Eye, Layers3, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FocusStackNativeInputPlan } from '../../../schemas/focus-stack/focusStackNativePlanSchemas';
import type { FocusStackOutputReviewWorkflow } from '../../../schemas/focus-stack/focusStackOutputReviewSchemas';
import type {
  FocusStackAlignmentMode,
  FocusStackQualityPreference,
  FocusStackReviewOverlayMode,
  FocusStackUiSettings,
} from '../../../schemas/focus-stack/focusStackUiSchemas';
import { type FocusStackModalState, useUIStore } from '../../../store/useUIStore';
import { TextColors, TextVariants } from '../../../types/typography';
import {
  buildFocusStackDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
} from '../../../utils/derivedOutputReceipt';
import { buildFocusStackOutputReviewWorkflow } from '../../../utils/focusStackOutputReview';
import type { FocusStackSourcePreflightMetadata } from '../../../utils/focusStackSourcePreflight';
import { buildFocusStackSourcePreflight } from '../../../utils/focusStackSourcePreflight';
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

interface FocusStackModalProps {
  isOpen: boolean;
  lastApplyCommand?: FocusStackModalState['lastApplyCommand'];
  lastDryRunCommand?: FocusStackModalState['lastDryRunCommand'];
  loadingImageUrl?: string | null;
  nativeInputPlan?: FocusStackNativeInputPlan | null;
  nativePlanError?: string | null;
  isNativePlanning?: boolean;
  onApplyPlan: () => void;
  onClose: () => void;
  onPreviewPlan: () => void;
  onSettingsChange: (settings: FocusStackUiSettings) => void;
  outputReview?: FocusStackOutputReviewWorkflow | null;
  outputReviewArtifactPath?: string;
  settings: FocusStackUiSettings;
  sourceCount: number;
  sourcePaths?: string[];
  sourcePreflightMetadata?: FocusStackSourcePreflightMetadata[];
}

const previewDimensionOptions = [2400, 4096, 8192] as const;
const haloSuppressionOptions = [0, 40, 80] as const;
const reviewOverlayOpacityOptions = [40, 70, 100] as const;
const reviewArtifactPath = '/tmp/rawengine-focus-stack-smoke.tif';

export function FocusStackModal({
  isOpen,
  lastApplyCommand,
  lastDryRunCommand,
  loadingImageUrl,
  nativeInputPlan = null,
  nativePlanError = null,
  isNativePlanning = false,
  onApplyPlan,
  onClose,
  onPreviewPlan,
  onSettingsChange,
  outputReview: runtimeOutputReview,
  outputReviewArtifactPath = reviewArtifactPath,
  settings,
  sourceCount,
  sourcePaths = [],
  sourcePreflightMetadata = [],
}: FocusStackModalProps) {
  const { t } = useTranslation();
  const [registrationView, setRegistrationView] = useState<'reference' | 'overlay' | 'difference'>('overlay');
  const [registrationSourceIndex, setRegistrationSourceIndex] = useState(0);

  const sourcePreflight = useMemo(
    () =>
      sourcePreflightMetadata.length > 0 ? buildFocusStackSourcePreflight({ sources: sourcePreflightMetadata }) : null,
    [sourcePreflightMetadata],
  );
  const isSourceCountValid = sourceCount >= 2 && sourceCount <= 128;
  const isPreviewPlanReady = nativeInputPlan?.accepted === true;
  const isDepthMapPreviewOnly = settings.blendMethod === 'depth_map';
  const selectedRegistrationPreview =
    nativeInputPlan?.previews.find((preview) => preview.sourceIndex === registrationSourceIndex) ??
    nativeInputPlan?.previews.find((preview) => preview.sourceIndex !== nativeInputPlan.referenceSourceIndex) ??
    nativeInputPlan?.previews[0];
  const registrationPreviewUrl =
    registrationView === 'reference'
      ? selectedRegistrationPreview?.referenceDataUrl
      : registrationView === 'difference'
        ? selectedRegistrationPreview?.differenceDataUrl
        : selectedRegistrationPreview?.overlayDataUrl;

  const alignmentOptions: Array<OptionItem<FocusStackAlignmentMode>> = [
    { label: t('modals.focusStack.alignmentAuto'), value: 'auto' },
    { label: t('modals.focusStack.alignmentTranslation'), value: 'translation' },
    { label: t('modals.focusStack.alignmentHomography'), value: 'homography' },
    { label: t('modals.focusStack.alignmentNone'), value: 'none' },
  ];

  const qualityOptions: Array<OptionItem<FocusStackQualityPreference>> = [
    { label: t('modals.focusStack.qualityPreview'), value: 'preview' },
    { label: t('modals.focusStack.qualityBalanced'), value: 'balanced' },
    { label: t('modals.focusStack.qualityBest'), value: 'best' },
  ];
  const reviewOverlayModes: FocusStackReviewOverlayMode[] = [
    'sharpness_map',
    'source_contribution',
    'low_confidence',
    'halo_risk',
  ];
  const selectedAlignmentLabel =
    alignmentOptions.find((option) => option.value === settings.alignmentMode)?.label ?? '';
  const selectedQualityLabel =
    qualityOptions.find((option) => option.value === settings.qualityPreference)?.label ?? '';
  const estimatedPreviewMegapixels = Math.round((sourceCount * settings.maxPreviewDimensionPx ** 2) / 1_000_000);
  const estimatedPreviewMemoryMb = Math.max(
    0,
    Math.round((sourceCount * settings.maxPreviewDimensionPx ** 2 * 4) / 1_000_000),
  );
  const sourceReadinessLabel = `${t('modals.focusStack.sourceSummary', { count: sourceCount })} - ${
    isPreviewPlanReady ? t('modals.focusStack.preflight.ready') : t('modals.focusStack.preflight.blocked')
  }`;
  const stackReadinessLabel = isPreviewPlanReady
    ? t('modals.focusStack.preflight.ready')
    : t('modals.focusStack.preflight.blocked');
  const sourcePreflightStatusLabel =
    sourcePreflight === null
      ? t('modals.focusStack.preflight.pending')
      : sourcePreflight.status === 'metadata_missing'
        ? t('modals.focusStack.preflight.pending')
        : sourcePreflight.status === 'blocked'
          ? t('modals.focusStack.preflight.blocked')
          : t('modals.focusStack.preflight.ready');
  const sourcePreflightConfidenceLabel =
    sourcePreflight?.validation === null || sourcePreflight === null
      ? t('modals.focusStack.preflight.pending')
      : `${Math.round(sourcePreflight.validation.detectionConfidence * 100)}%`;
  const sourcePreflightFocusSpanLabel =
    sourcePreflight?.validation?.focusSpanMm === null || sourcePreflight?.validation?.focusSpanMm === undefined
      ? t('modals.focusStack.preflight.pending')
      : `${sourcePreflight.validation.focusSpanMm} mm`;
  const fallbackOutputReviewSourceCount = Math.max(2, sourceCount);
  const outputReview =
    runtimeOutputReview ??
    buildFocusStackOutputReviewWorkflow({
      artifactPath: outputReviewArtifactPath,
      settings,
      sourceCount: fallbackOutputReviewSourceCount,
      sourcePaths,
    });
  const hasRuntimeOutputReview = runtimeOutputReview !== null && runtimeOutputReview !== undefined;
  const derivedOutputReceipt = buildFocusStackDerivedOutputReceipt({
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
    isPreviewPlanReady &&
    hasRuntimeOutputReview &&
    outputReview.decision !== 'preview_only' &&
    outputReview.editableHandoff.status !== 'blocked';
  const previewPlanStatusLabel = hasRuntimeOutputReview
    ? t('modals.focusStack.previewPlanReady')
    : t('modals.focusStack.previewPlanPending');
  const outputReviewDecisionLabel = t(`modals.focusStack.review.decision.${outputReview.decision}`);
  const outputReviewWarningsLabel = outputReview.warningCodes
    .map((warningCode) => t(`modals.focusStack.review.warning.${warningCode}`))
    .join(', ');
  const reviewOverlayLabel = t(`modals.focusStack.review.overlayMode.${outputReview.reviewOverlay.mode}.label`);
  const haloReviewStatusLabel = t(`modals.focusStack.review.haloReviewStatus.${outputReview.haloReview.reviewStatus}`);
  const editableHandoffStatusLabel = t(
    `modals.focusStack.review.editableHandoffStatus.${outputReview.editableHandoff.status}`,
  );
  const applyReceiptStatusLabel = t(`modals.focusStack.review.applyReceiptStatus.${outputReview.applyReceipt.status}`);
  const applyReceiptAlignmentStatusLabel = t(
    `modals.focusStack.review.alignmentStatus.${outputReview.applyReceipt.alignment.status}`,
  );
  const applyReceiptPreviewDimensionsLabel =
    outputReview.applyReceipt.outputPreviewDimensions === undefined
      ? t('modals.focusStack.preflight.pending')
      : t('modals.focusStack.review.previewDimensionsValue', {
          height: outputReview.applyReceipt.outputPreviewDimensions.height,
          width: outputReview.applyReceipt.outputPreviewDimensions.width,
        });
  const applyReceiptSharpnessSummaryLabel =
    outputReview.applyReceipt.sharpnessQualitySummary === undefined
      ? t('modals.focusStack.review.qualitySummaryUnavailable')
      : t('modals.focusStack.review.qualitySummaryValue', {
          low: Math.round((outputReview.applyReceipt.sharpnessQualitySummary.lowConfidenceCellRatio ?? 0) * 100),
          quality: t(
            `modals.focusStack.quality.${outputReview.applyReceipt.sharpnessQualitySummary.qualityPreference}`,
          ),
          sharpness: Math.round((outputReview.applyReceipt.sharpnessQualitySummary.sharpnessCoverageRatio ?? 0) * 100),
        });
  const sourceContributionLabel = outputReview.reviewOverlay.sourceContributionSummary
    .map((source) =>
      t('modals.focusStack.review.sourceContributionValue', {
        index: source.sourceIndex + 1,
        value: Math.round(source.winnerCellRatio * 100),
      }),
    )
    .join(' / ');
  const focusSourcePaths = outputReview.sourceRefs.map((source) => source.path).join(',');
  const focusSourceGraphRevisions = outputReview.sourceRefs.map((source) => source.graphRevision).join(',');
  const getSourceContributionWarningLabel = (
    warningState: (typeof outputReview.reviewOverlay.sourceContributionDetails)[number]['warningState'],
  ) => {
    if (warningState === 'artifact_review_required') return outputReviewWarningsLabel;
    return t('modals.focusStack.preflight.ready');
  };

  const setSetting = useCallback(
    (patch: Partial<FocusStackUiSettings>) => {
      onSettingsChange({ ...settings, ...patch });
    },
    [onSettingsChange, settings],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <ComputationalSetupModalShell
      appServerFamily="focus_stack"
      appServerStatusLabel={t('editor.ai.connection.ready')}
      Icon={Aperture}
      isOpen={isOpen}
      loadingImageUrl={loadingImageUrl}
      onClose={handleClose}
      sourcePreviewAlt={t('modals.common.sourcePreviewAlt')}
      sourceSummary={t('modals.focusStack.sourceSummary', { count: sourceCount })}
      title={t('modals.focusStack.title')}
      titleId="focus-stack-modal-title"
      workflowStatus={t('modals.focusStack.workflowStatus')}
      workflowTitle={t('modals.focusStack.workflowTitle')}
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
            type="button"
          >
            {t('modals.focusStack.close')}
          </button>
          <Button onClick={onPreviewPlan} disabled={!isSourceCountValid || isNativePlanning}>
            <Layers3 className="w-4 h-4" />
            {hasRuntimeOutputReview ? t('modals.focusStack.refreshPreviewPlan') : t('modals.focusStack.previewPlan')}
          </Button>
          <Button onClick={onApplyPlan} disabled={!isApplyPlanReady}>
            <CheckCircle2 className="w-4 h-4" />
            {t('modals.transform.apply')}
          </Button>
        </>
      }
    >
      {!isPreviewPlanReady && (
        <ComputationalSetupSourceWarning>
          {nativePlanError ??
            nativeInputPlan?.blockCodes.join(', ') ??
            (isNativePlanning ? t('modals.focusStack.preflight.pending') : t('modals.focusStack.sourceCountBlocked'))}
        </ComputationalSetupSourceWarning>
      )}

      {nativeInputPlan !== null && (
        <section
          className="border border-border-color bg-bg-secondary/70 p-2 text-sm"
          data-testid="focus-stack-native-readiness"
        >
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <ComputationalSetupStatusLine label="Native plan" value={nativeInputPlan.acceptedDryRunPlanId} />
            <ComputationalSetupStatusLine label="Reference" value={`${nativeInputPlan.referenceSourceIndex + 1}`} />
            <ComputationalSetupStatusLine label="Focus order" value={nativeInputPlan.focusOrderSource} />
            <ComputationalSetupStatusLine
              label="Geometry"
              value={`${nativeInputPlan.commonGeometry.width} x ${nativeInputPlan.commonGeometry.height}`}
            />
            <ComputationalSetupStatusLine
              label="Diagnostics"
              value={nativeInputPlan.warningCodes.join(', ') || t('modals.focusStack.preflight.ready')}
            />
          </div>
          <div className="mt-2 max-h-36 overflow-y-auto border-t border-border-color pt-2">
            {nativeInputPlan.sources.map((source) => (
              <div className="grid grid-cols-[3rem_1fr_8rem] gap-2 py-1" key={source.contentHash}>
                <span>
                  {source.sourceIndex + 1}
                  {source.sourceIndex === nativeInputPlan.referenceSourceIndex ? ' *' : ''}
                </span>
                <span>
                  {source.cameraMake} {source.cameraModel}
                  {source.lensModel === null ? '' : ` / ${source.lensModel}`}
                </span>
                <span>
                  {source.width} x {source.height} / {source.sourceKind === 'raw_sensor_source' ? 'RAW' : 'RGB'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {nativeInputPlan !== null && nativeInputPlan.previews.length > 0 && registrationPreviewUrl !== undefined && (
        <section
          className="border border-border-color bg-bg-primary p-2"
          data-testid="focus-stack-registration-preview"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="group" aria-label={t('modals.focusStack.preflight.sources')}>
              {nativeInputPlan.previews.map((preview) => (
                <button
                  aria-pressed={preview.sourceIndex === selectedRegistrationPreview?.sourceIndex}
                  className="h-8 min-w-8 border border-border-color px-2 text-xs aria-pressed:bg-card-active"
                  key={preview.sourceIndex}
                  onClick={() => setRegistrationSourceIndex(preview.sourceIndex)}
                  type="button"
                >
                  {preview.sourceIndex + 1}
                </button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label={t('modals.focusStack.review.overlay')}>
              {(['reference', 'overlay', 'difference'] as const).map((view) => (
                <button
                  aria-pressed={registrationView === view}
                  className="h-8 border border-border-color px-2 text-xs capitalize aria-pressed:bg-card-active"
                  key={view}
                  onClick={() => setRegistrationView(view)}
                  type="button"
                >
                  {view}
                </button>
              ))}
            </div>
          </div>
          <img
            alt={t('modals.common.sourcePreviewAlt')}
            className="max-h-72 w-full bg-black object-contain"
            src={registrationPreviewUrl}
          />
          {selectedRegistrationPreview !== undefined && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs lg:grid-cols-5">
              {(() => {
                const transform = nativeInputPlan.transforms.find(
                  (candidate) => candidate.sourceIndex === selectedRegistrationPreview.sourceIndex,
                );
                if (transform === undefined) return null;
                return (
                  <>
                    <ComputationalSetupStatusLine label="Status" value={transform.status} />
                    <ComputationalSetupStatusLine label="Scale" value={transform.scale.toFixed(6)} />
                    <ComputationalSetupStatusLine
                      label="Rotation"
                      value={`${transform.rotationDegrees.toFixed(4)} deg`}
                    />
                    <ComputationalSetupStatusLine
                      label="Translation"
                      value={`${transform.translationXPx.toFixed(3)}, ${transform.translationYPx.toFixed(3)} px`}
                    />
                    <ComputationalSetupStatusLine
                      label="P95 residual"
                      value={`${transform.p95ResidualPx.toFixed(3)} px`}
                    />
                  </>
                );
              })()}
            </div>
          )}
        </section>
      )}

      <section
        className="grid grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-sm lg:grid-cols-5"
        data-estimated-preview-memory-mb={estimatedPreviewMemoryMb}
        data-estimated-preview-megapixels={estimatedPreviewMegapixels}
        data-preview-source-count={sourceCount}
        data-testid="focus-stack-setup-summary"
      >
        <ComputationalSetupStatusLine label={t('modals.focusStack.preflight.sources')} value={sourceReadinessLabel} />
        <ComputationalSetupStatusLine label={t('modals.focusStack.qualityLabel')} value={selectedQualityLabel} />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.workload')}
          value={t('modals.focusStack.previewWorkloadValue', { value: estimatedPreviewMegapixels })}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.memory')}
          value={t('modals.focusStack.previewMemoryValue', { value: estimatedPreviewMemoryMb })}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.blend')}
          value={t(`modals.focusStack.blendMethod.${settings.blendMethod}.label`)}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.haloSuppressionLabel')}
          value={t('modals.focusStack.haloSuppressionValue', { value: settings.haloSuppressionStrengthPercent })}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.retouch')}
          value={t(`modals.focusStack.retouchPolicy.${settings.retouchLayerPolicy}.label`)}
        />
      </section>
      <section
        className="grid grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-2 text-sm lg:grid-cols-5"
        data-alignment-mode={settings.alignmentMode}
        data-blend-method={settings.blendMethod}
        data-source-count={sourceCount}
        data-stack-ready={String(isSourceCountValid)}
        data-testid="focus-stack-readiness-summary"
      >
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.sources')}
          value={t('modals.focusStack.sourceSummary', { count: sourceCount })}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.alignment')}
          value={selectedAlignmentLabel}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.blend')}
          value={t(`modals.focusStack.blendMethod.${settings.blendMethod}.label`)}
        />
        <ComputationalSetupStatusLine label={t('modals.focusStack.workflowTitle')} value={stackReadinessLabel} />
        <ComputationalSetupStatusLine label={t('modals.focusStack.previewPlanStatus')} value={previewPlanStatusLabel} />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.review.applyReceipt')}
          value={applyReceiptStatusLabel}
        />
      </section>

      <section
        className="grid grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-2 text-sm lg:grid-cols-5"
        data-block-count={sourcePreflight?.validation?.blockCodes.length ?? 0}
        data-focus-span-mm={sourcePreflight?.validation?.focusSpanMm ?? ''}
        data-missing-metadata-count={sourcePreflight?.missingMetadataCount ?? sourceCount}
        data-source-preflight-status={sourcePreflight?.status ?? 'not_measured'}
        data-testid="focus-stack-source-preflight"
        data-warning-count={sourcePreflight?.validation?.warningCodes.length ?? 0}
      >
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.sources')}
          value={sourcePreflightStatusLabel}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.provenance')}
          value={sourcePreflightConfidenceLabel}
        />
        <ComputationalSetupStatusLine label={t('modals.focusStack.preflight.required')} value={String(sourceCount)} />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.previewBudget')}
          value={sourcePreflightFocusSpanLabel}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.blocked')}
          value={String(sourcePreflight?.validation?.blockCodes.length ?? 0)}
        />
      </section>

      {lastDryRunCommand && (
        <section
          className="grid grid-cols-3 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-3 text-xs"
          data-command-type={lastDryRunCommand.commandType}
          data-dry-run={String(lastDryRunCommand.dryRun)}
          data-source-count={lastDryRunCommand.sources}
          data-testid="focus-dry-run-command-state"
          data-tool-name={lastDryRunCommand.toolName}
        >
          {[
            {
              label: t('modals.focusStack.dryRunCommandTool'),
              value: lastDryRunCommand.toolName,
            },
            {
              label: t('modals.focusStack.dryRunCommandSources'),
              value: t('modals.focusStack.sourceSummary', { count: lastDryRunCommand.sources }),
            },
            {
              label: t('modals.focusStack.dryRunCommandMode'),
              value: t('modals.focusStack.dryRunCommandModeValue'),
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
          data-source-count={lastApplyCommand.sources}
          data-testid="focus-apply-command-state"
          data-tool-name={lastApplyCommand.toolName}
        >
          {[
            {
              label: t('modals.focusStack.dryRunCommandTool'),
              value: lastApplyCommand.toolName,
            },
            {
              label: t('modals.focusStack.previewPlanStatus'),
              value: applyReceiptStatusLabel,
            },
            {
              label: t('modals.focusStack.review.editableArtifact'),
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
            {t('modals.focusStack.alignmentLabel')}
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
            {t('modals.focusStack.qualityLabel')}
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

      <ComputationalSetupOptionSection title={t('modals.focusStack.blendLabel')}>
        <div className="grid grid-cols-3 gap-2">
          {(['laplacian_pyramid', 'weighted_sharpness', 'depth_map'] as const).map((blendMethod) => (
            <button
              key={blendMethod}
              className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                settings.blendMethod === blendMethod
                  ? 'border-accent bg-accent/15'
                  : 'border-border-color bg-bg-primary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ blendMethod });
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t(`modals.focusStack.blendMethod.${blendMethod}.label`)}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                {t(`modals.focusStack.blendMethod.${blendMethod}.status`)}
              </UiText>
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.focusStack.retouchLabel')}>
        <div className="grid grid-cols-2 gap-2">
          {(['generate_retouch_layer', 'none'] as const).map((retouchLayerPolicy) => (
            <button
              key={retouchLayerPolicy}
              className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                settings.retouchLayerPolicy === retouchLayerPolicy
                  ? 'border-accent bg-accent/15'
                  : 'border-border-color bg-bg-primary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ retouchLayerPolicy });
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t(`modals.focusStack.retouchPolicy.${retouchLayerPolicy}.label`)}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                {t(`modals.focusStack.retouchPolicy.${retouchLayerPolicy}.status`)}
              </UiText>
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.focusStack.haloSuppressionLabel')}>
        <div
          className="grid grid-cols-3 gap-2"
          data-halo-risk-cell-ratio={outputReview.haloRiskCellRatio}
          data-halo-suppression-strength-percent={settings.haloSuppressionStrengthPercent}
          data-testid="focus-halo-suppression-controls"
        >
          {haloSuppressionOptions.map((haloSuppressionStrengthPercent) => (
            <button
              key={haloSuppressionStrengthPercent}
              className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                settings.haloSuppressionStrengthPercent === haloSuppressionStrengthPercent
                  ? 'border-accent bg-accent/15'
                  : 'border-border-color bg-bg-primary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ haloSuppressionStrengthPercent });
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t('modals.focusStack.haloSuppressionValue', { value: haloSuppressionStrengthPercent })}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                {t(
                  haloSuppressionStrengthPercent === 0
                    ? 'modals.focusStack.haloSuppressionOff'
                    : 'modals.focusStack.haloSuppressionOn',
                )}
              </UiText>
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.focusStack.previewBudgetLabel')}>
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
              {t('modals.focusStack.previewBudgetValue', { value: maxPreviewDimensionPx })}
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.focusStack.review.overlayTitle')}>
        <div
          className="space-y-3"
          data-focus-overlay-mode={settings.reviewOverlayMode}
          data-focus-overlay-opacity-percent={settings.reviewOverlayOpacityPercent}
          data-focus-overlay-source-count={outputReview.reviewOverlay.sourceContributionSummary.length}
          data-testid="focus-sharpness-overlay-controls"
        >
          <div className="grid grid-cols-4 gap-2">
            {reviewOverlayModes.map((reviewOverlayMode) => (
              <button
                key={reviewOverlayMode}
                className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                  settings.reviewOverlayMode === reviewOverlayMode
                    ? 'border-accent bg-accent/15'
                    : 'border-border-color bg-bg-primary hover:bg-card-active'
                }`}
                onClick={() => {
                  setSetting({ reviewOverlayMode });
                }}
                type="button"
              >
                <UiText as="span" variant={TextVariants.label}>
                  {t(`modals.focusStack.review.overlayMode.${reviewOverlayMode}.label`)}
                </UiText>
                <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                  {t(`modals.focusStack.review.overlayMode.${reviewOverlayMode}.status`)}
                </UiText>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-border-color bg-bg-primary p-3">
            <div className="flex items-start gap-2">
              <Eye className="mt-0.5 h-4 w-4 text-accent" />
              <div>
                <UiText variant={TextVariants.label}>{reviewOverlayLabel}</UiText>
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                  {sourceContributionLabel}
                </UiText>
              </div>
            </div>
            <div className="flex gap-1">
              {reviewOverlayOpacityOptions.map((reviewOverlayOpacityPercent) => (
                <button
                  key={reviewOverlayOpacityPercent}
                  className={`h-8 rounded-md border px-2 text-xs transition-colors ${
                    settings.reviewOverlayOpacityPercent === reviewOverlayOpacityPercent
                      ? 'border-accent bg-accent/15 text-text-primary'
                      : 'border-border-color bg-bg-secondary text-text-secondary hover:bg-card-active'
                  }`}
                  onClick={() => {
                    setSetting({ reviewOverlayOpacityPercent });
                  }}
                  type="button"
                >
                  {t('modals.focusStack.review.opacityValue', { value: reviewOverlayOpacityPercent })}
                </button>
              ))}
            </div>
          </div>
          <div
            className="grid gap-2 rounded-md border border-border-color bg-bg-primary p-3 sm:grid-cols-2 lg:grid-cols-3"
            data-focus-source-detail-count={outputReview.reviewOverlay.sourceContributionDetails.length}
            data-testid="focus-source-contribution-details"
          >
            {outputReview.reviewOverlay.sourceContributionDetails.map((source) => (
              <div
                className="rounded-md border border-border-color bg-bg-secondary/70 p-2 text-sm"
                data-artifact-id={source.artifactId}
                data-confidence-percent={source.confidencePercent}
                data-contribution-percent={Math.round(source.contributionRatio * 100)}
                data-coverage-cell-count={source.coverageCellCount}
                data-source-id={source.sourceId}
                data-warning-state={source.warningState}
                data-testid={`focus-source-contribution-${source.sourceId}`}
                key={source.sourceId}
              >
                <div className="flex items-center justify-between gap-2">
                  <UiText as="span" variant={TextVariants.label}>
                    {source.sourceId}
                  </UiText>
                  <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
                    {t('modals.focusStack.review.percentValue', {
                      value: Math.round(source.contributionRatio * 100),
                    })}
                  </UiText>
                </div>
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                  {getSourceContributionWarningLabel(source.warningState)}
                </UiText>
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                  {t('modals.focusStack.review.sourceConfidenceCoverageValue', {
                    cells: source.coverageCellCount,
                    confidence: source.confidencePercent,
                  })}
                </UiText>
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 truncate font-mono">
                  {source.artifactId}
                </UiText>
              </div>
            ))}
          </div>
        </div>
      </ComputationalSetupOptionSection>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-md border border-border-color bg-bg-primary p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-5 h-5 text-accent" />
          <UiText variant={TextVariants.heading}>{t('modals.focusStack.preflightTitle')}</UiText>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <ComputationalSetupStatusLine label={t('modals.focusStack.preflight.sources')} value={sourceReadinessLabel} />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.alignment')}
            value={t(`modals.focusStack.alignment.${settings.alignmentMode}`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.blend')}
            value={t(`modals.focusStack.blendMethod.${settings.blendMethod}.label`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.haloSuppressionLabel')}
            value={t('modals.focusStack.haloSuppressionValue', { value: settings.haloSuppressionStrengthPercent })}
          />
          <ComputationalSetupStatusLine label={t('modals.focusStack.qualityLabel')} value={selectedQualityLabel} />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.retouch')}
            value={t(`modals.focusStack.retouchPolicy.${settings.retouchLayerPolicy}.label`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.previewBudget')}
            value={t('modals.focusStack.previewBudgetValue', { value: settings.maxPreviewDimensionPx })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.workload')}
            value={t('modals.focusStack.previewWorkloadValue', { value: estimatedPreviewMegapixels })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.memory')}
            value={t('modals.focusStack.previewMemoryValue', { value: estimatedPreviewMemoryMb })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.provenance')}
            value={t('modals.focusStack.preflight.required')}
          />
        </div>
      </motion.section>

      <ComputationalMergeReviewPanel
        derivedOutputReceipt={visibleDerivedOutputReceipt}
        title={t('modals.focusStack.review.title')}
        proofStatus={t('modals.focusStack.review.proofStatus')}
        limitation={t('modals.focusStack.review.limitation')}
        testId="focus-review-diagnostics"
        items={[
          {
            label: t('modals.focusStack.review.sharpnessMap'),
            status: 'ready',
            value: applyReceiptSharpnessSummaryLabel,
          },
          {
            label: t('modals.focusStack.review.applyReceipt'),
            status: outputReview.applyReceipt.status === 'apply_ready' ? 'ready' : 'review',
            value: `${applyReceiptStatusLabel} - ${outputReview.applyReceipt.receiptId}`,
          },
          {
            label: t('modals.focusStack.review.previewDimensions'),
            status: outputReview.applyReceipt.outputPreviewDimensions === undefined ? 'pending' : 'ready',
            value: applyReceiptPreviewDimensionsLabel,
          },
          {
            label: t('modals.focusStack.review.editableArtifact'),
            status: 'review',
            value: `${outputReviewDecisionLabel} - ${editableHandoffStatusLabel}`,
          },
          {
            label: t('modals.focusStack.review.sharpnessCoverage'),
            status: 'ready',
            value: t('modals.focusStack.review.percentValue', {
              value: Math.round(outputReview.sharpnessCoverageRatio * 100),
            }),
          },
          {
            label: t('modals.focusStack.review.transitionRisk'),
            status: 'pending',
            value: `${haloReviewStatusLabel} - ${outputReviewWarningsLabel}`,
          },
          {
            label: t('modals.focusStack.review.overlay'),
            status: 'review',
            value: t('modals.focusStack.review.overlayValue', {
              mode: reviewOverlayLabel,
              value: outputReview.reviewOverlay.opacityPercent,
            }),
          },
          {
            label: t('modals.focusStack.review.sourceContribution'),
            status: 'ready',
            value: sourceContributionLabel,
          },
        ]}
        sections={[
          {
            title: t('modals.focusStack.preflightTitle'),
            rows: [
              {
                label: t('modals.focusStack.preflight.sources'),
                value: sourceReadinessLabel,
              },
              {
                label: t('modals.focusStack.preflight.alignment'),
                value: `${t(`modals.focusStack.alignment.${outputReview.applyReceipt.alignment.mode}`)} - ${applyReceiptAlignmentStatusLabel}`,
              },
              {
                label: t('modals.focusStack.qualityLabel'),
                value: selectedQualityLabel,
              },
              {
                label: t('modals.focusStack.preflight.previewBudget'),
                value: t('modals.focusStack.previewBudgetValue', { value: settings.maxPreviewDimensionPx }),
              },
              {
                label: t('modals.focusStack.preflight.workload'),
                value: t('modals.focusStack.previewWorkloadValue', { value: estimatedPreviewMegapixels }),
              },
              {
                label: t('modals.focusStack.preflight.memory'),
                value: t('modals.focusStack.previewMemoryValue', { value: estimatedPreviewMemoryMb }),
              },
              {
                label: t('modals.focusStack.preflight.blend'),
                value: t(`modals.focusStack.blendMethod.${settings.blendMethod}.label`),
              },
              {
                label: t('modals.focusStack.haloSuppressionLabel'),
                value: t('modals.focusStack.haloSuppressionValue', {
                  value: settings.haloSuppressionStrengthPercent,
                }),
              },
            ],
          },
          {
            title: t('modals.focusStack.review.title'),
            rows: [
              {
                label: t('modals.focusStack.review.editableArtifact'),
                value: `${outputReviewDecisionLabel} - ${outputReview.editableHandoff.artifactId}`,
              },
              {
                label: t('modals.focusStack.review.applyReceipt'),
                value: `${applyReceiptStatusLabel} - ${outputReview.applyReceipt.receiptId}`,
              },
              {
                label: t('modals.focusStack.review.previewDimensions'),
                value: applyReceiptPreviewDimensionsLabel,
              },
              {
                label: t('modals.focusStack.review.artifactHandle'),
                value: outputReview.applyReceipt.artifactHandle.artifactId,
              },
              {
                label: t('modals.focusStack.preflight.retouch'),
                value: t(`modals.focusStack.retouchPolicy.${settings.retouchLayerPolicy}.label`),
              },
              {
                label: t('modals.focusStack.review.lowConfidenceCells'),
                value: t('modals.focusStack.review.percentValue', {
                  value: Math.round(outputReview.lowConfidenceCellRatio * 100),
                }),
              },
              {
                label: t('modals.focusStack.review.haloRiskCells'),
                value: t('modals.focusStack.review.percentValue', {
                  value: Math.round(outputReview.haloRiskCellRatio * 100),
                }),
              },
              {
                label: t('modals.focusStack.review.provenance'),
                value: outputReview.artifactPath,
              },
              {
                label: t('modals.focusStack.review.transitionRisk'),
                value: `${haloReviewStatusLabel} - ${outputReviewWarningsLabel}`,
              },
              {
                label: t('modals.focusStack.review.exportHandoff'),
                value: outputReview.editableHandoff.exportReviewArtifactId,
              },
              {
                label: t('modals.focusStack.review.retouchedExportParity'),
                value:
                  outputReview.editableHandoff.retouchedExportParity?.status ??
                  t('modals.focusStack.review.retouchedExportParityPending'),
              },
              {
                label: t('modals.focusStack.review.overlay'),
                value: t('modals.focusStack.review.overlayValue', {
                  mode: reviewOverlayLabel,
                  value: outputReview.reviewOverlay.opacityPercent,
                }),
              },
              {
                label: t('modals.focusStack.review.sourceContribution'),
                value: sourceContributionLabel,
              },
              {
                label: t('modals.focusStack.preflight.sources'),
                value: focusSourceGraphRevisions,
              },
            ],
          },
        ]}
      />

      <section
        className="rounded-md border border-border-color bg-bg-primary p-4"
        data-editable-artifact-hash={outputReview.editableHandoff.artifactHash}
        data-editable-artifact-id={outputReview.editableHandoff.artifactId}
        data-editable-handoff-status={outputReview.editableHandoff.status}
        data-focus-apply-receipt-artifact-handle={outputReview.applyReceipt.artifactHandle.artifactId}
        data-focus-apply-receipt-artifact-path={outputReview.applyReceipt.artifactPath}
        data-focus-apply-receipt-id={outputReview.applyReceipt.receiptId}
        data-focus-apply-receipt-status={outputReview.applyReceipt.status}
        data-focus-apply-receipt-warning-count={outputReview.applyReceipt.warnings.length}
        data-focus-output-preview-height={outputReview.applyReceipt.outputPreviewDimensions?.height ?? ''}
        data-focus-output-preview-width={outputReview.applyReceipt.outputPreviewDimensions?.width ?? ''}
        data-export-review-artifact-id={outputReview.editableHandoff.exportReviewArtifactId}
        data-retouched-export-parity-export-receipt-hash={
          outputReview.editableHandoff.retouchedExportParity?.exportReceiptHash ?? ''
        }
        data-retouched-export-parity-mean-abs-delta={
          outputReview.editableHandoff.retouchedExportParity?.meanAbsDelta ?? ''
        }
        data-retouched-export-parity-preview-state-hash={
          outputReview.editableHandoff.retouchedExportParity?.previewStateHash ?? ''
        }
        data-retouched-export-parity-proof-hash={
          outputReview.editableHandoff.retouchedExportParity?.parityProofHash ?? ''
        }
        data-retouched-export-parity-status={outputReview.editableHandoff.retouchedExportParity?.status ?? 'pending'}
        data-halo-artifact-id={outputReview.haloReview.artifactId}
        data-halo-review-status={outputReview.haloReview.reviewStatus}
        data-halo-risk-cell-ratio={outputReview.haloRiskCellRatio}
        data-halo-suppression-strength-percent={settings.haloSuppressionStrengthPercent}
        data-low-confidence-cell-ratio={outputReview.lowConfidenceCellRatio}
        data-runtime-output-review={String(hasRuntimeOutputReview)}
        data-source-graph-revisions={focusSourceGraphRevisions}
        data-source-paths={focusSourcePaths}
        data-testid="focus-editable-handoff-proof"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <UiText variant={TextVariants.heading}>{t('modals.focusStack.review.haloReviewTitle')}</UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              {t('modals.focusStack.review.haloReviewSummary', {
                halo: Math.round(outputReview.haloRiskCellRatio * 100),
                low: Math.round(outputReview.lowConfidenceCellRatio * 100),
              })}
            </UiText>
          </div>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="shrink-0">
            {editableHandoffStatusLabel}
          </UiText>
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          {outputReview.haloReview.transitionRiskRegions.map((region) => (
            <div
              className="rounded-md border border-border-color bg-bg-secondary/70 p-3"
              data-region-cell-count={region.cellCount}
              data-region-id={region.regionId}
              data-region-risk={region.risk}
              data-source-index={region.sourceIndex}
              key={region.regionId}
            >
              <UiText variant={TextVariants.label}>
                {t(`modals.focusStack.review.haloRegionRisk.${region.risk}`)}
              </UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                {t('modals.focusStack.review.sourceIndexValue', { index: region.sourceIndex + 1 })}
              </UiText>
            </div>
          ))}
        </div>
      </section>

      {isDepthMapPreviewOnly && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <UiText className="leading-relaxed">{t('modals.focusStack.depthMapNotice')}</UiText>
        </div>
      )}

      <div className="rounded-md border border-border-color bg-bg-primary px-4 py-3 flex gap-3">
        <CheckCircle2 className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
        <UiText className="leading-relaxed">{t('modals.focusStack.planDependency')}</UiText>
      </div>
    </ComputationalSetupModalShell>
  );
}

export default FocusStackModal;
