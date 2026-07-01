import { Info, Layers, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import type {
  PanoramaRenderedReview,
  PanoramaRuntimePlan,
  PanoramaSavedReviewSummary,
  PanoramaUiBlendMode,
  PanoramaUiBoundaryMode,
  PanoramaUiExposureMode,
  PanoramaUiProjection,
  PanoramaUiQualityPreference,
  PanoramaUiSettings,
} from '../../../schemas/computational-merge/panoramaUiSchemas';
import { type PanoramaModalState, useUIStore } from '../../../store/useUIStore';
import { TextColors, TextVariants } from '../../../types/typography';
import {
  buildPanoramaDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
} from '../../../utils/derivedOutputReceipt';
import { buildPanoramaSavedReviewSummary } from '../../../utils/panoramaSavedReview';
import Dropdown, { type OptionItem } from '../../ui/primitives/Dropdown';
import UiText from '../../ui/primitives/Text';
import ComputationalMergeAppServerBadge from './ComputationalMergeAppServerBadge';
import ComputationalMergeReviewPanel from './ComputationalMergeReviewPanel';
import DerivedOutputReceiptPanel from './DerivedOutputReceiptPanel';
import { MergeErrorState, MergeFooterActions, MergeProcessingState, MergeResultPreview } from './MergeStatusViews';

interface PanoramaModalProps {
  error: string | null;
  finalImageBase64: string | null;
  imageCount?: number;
  isOpen: boolean;
  isProcessing: boolean;
  lastApplyCommand: PanoramaModalState['lastApplyCommand'];
  lastDryRunCommand: PanoramaModalState['lastDryRunCommand'];
  loadingImageUrl?: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onSave: () => Promise<string>;
  onSettingsChange: (settings: PanoramaUiSettings) => void;
  onStitch: () => void;
  progressMessage: string | null;
  renderedReview: PanoramaRenderedReview | null;
  runtimePlan: PanoramaRuntimePlan | null;
  settings: PanoramaUiSettings;
  sourcePaths?: string[];
}

export default function PanoramaModal({
  error,
  finalImageBase64,
  imageCount,
  isOpen,
  isProcessing,
  lastApplyCommand,
  lastDryRunCommand,
  loadingImageUrl,
  onClose,
  onOpenFile,
  onSave,
  onSettingsChange,
  onStitch,
  progressMessage,
  renderedReview,
  runtimePlan,
  settings,
  sourcePaths = [],
}: PanoramaModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [savedReviewSummary, setSavedReviewSummary] = useState<PanoramaSavedReviewSummary | null>(null);
  const [savedDerivedOutputReceiptId, setSavedDerivedOutputReceiptId] = useState<string | null>(null);

  const mouseDownTarget = useRef<EventTarget | null>(null);
  const isSourceCountValid = (imageCount ?? 0) >= 2;

  const projectionOptions: Array<OptionItem<PanoramaUiProjection>> = [
    { label: t('modals.panorama.projection.rectilinear'), value: 'rectilinear' },
    { label: t('modals.panorama.projection.cylindrical'), value: 'cylindrical' },
    { label: t('modals.panorama.projection.spherical'), value: 'spherical' },
  ];
  const qualityOptions: Array<OptionItem<PanoramaUiQualityPreference>> = [
    { label: t('modals.panorama.quality.preview'), value: 'preview' },
    { label: t('modals.panorama.quality.balanced'), value: 'balanced' },
    { label: t('modals.panorama.quality.best'), value: 'best' },
  ];
  const boundaryOptions: Array<OptionItem<PanoramaUiBoundaryMode>> = [
    { label: t('modals.panorama.boundary.autoCrop'), value: 'auto_crop' },
    { label: t('modals.panorama.boundary.transparent'), value: 'transparent' },
    { label: t('modals.panorama.boundary.manualCrop'), value: 'manual_crop' },
  ];
  const supportedProjection = settings.projection === 'rectilinear' || settings.projection === 'cylindrical';
  const supportedBoundary = settings.boundaryMode === 'auto_crop' || settings.boundaryMode === 'manual_crop';
  const isEngineApplyReady = isSourceCountValid && supportedProjection && supportedBoundary;
  const exposureOptions: Array<OptionItem<PanoramaUiExposureMode>> = [
    { label: t('modals.panorama.exposure.gainCompensation'), value: 'gain_compensation' },
    { label: t('modals.panorama.exposure.none'), value: 'none' },
  ];
  const selectedBoundaryLabel = boundaryOptions.find((option) => option.value === settings.boundaryMode)?.label ?? '';
  const selectedExposureLabel = exposureOptions.find((option) => option.value === settings.exposureMode)?.label ?? '';
  const selectedProjectionLabel = projectionOptions.find((option) => option.value === settings.projection)?.label ?? '';
  const selectedQualityLabel =
    qualityOptions.find((option) => option.value === settings.qualityPreference)?.label ?? '';
  const manualCropInsetControls = [
    { key: 'top', label: t('modals.panorama.manualCrop.top') },
    { key: 'right', label: t('modals.panorama.manualCrop.right') },
    { key: 'bottom', label: t('modals.panorama.manualCrop.bottom') },
    { key: 'left', label: t('modals.panorama.manualCrop.left') },
  ] as const;
  const manualCropLabel = t('modals.panorama.manualCrop.value', {
    bottom: settings.manualCropInsetsPercent.bottom,
    left: settings.manualCropInsetsPercent.left,
    right: settings.manualCropInsetsPercent.right,
    top: settings.manualCropInsetsPercent.top,
  });
  const estimatedPreviewMegapixels = Math.round(((imageCount ?? 0) * settings.maxPreviewDimensionPx ** 2) / 1_000_000);
  const estimatedPreviewMemoryMb = Math.max(
    0,
    Math.round(((imageCount ?? 0) * settings.maxPreviewDimensionPx ** 2 * 4) / 1_000_000),
  );
  const runtimePlanMemoryMb =
    runtimePlan === null
      ? null
      : Math.round(runtimePlan.preflight.memory_components.total_estimated_peak_bytes / 1_000_000);
  const runtimePlanOutput = runtimePlan
    ? `${runtimePlan.output_dimensions.width} x ${runtimePlan.output_dimensions.height}`
    : t('modals.panorama.summaryBlocked');
  const runtimePlanTileCount = runtimePlan?.preflight.tile_count ?? null;
  const runtimePlanWorkload =
    runtimePlan === null ? runtimePlanOutput : `${runtimePlanOutput} / ${runtimePlanTileCount ?? 0} tiles`;
  const runtimePlanStatus =
    runtimePlan === null
      ? t('modals.panorama.summaryBlocked')
      : runtimePlan.preflight.status === 'blocked_plan_only'
        ? t('modals.panorama.summaryBlocked')
        : t('modals.panorama.summaryReady');
  const runtimePlanSourceGeometry = runtimePlan?.preflight.source_geometry;
  const sourceReadinessLabel = `${t('modals.panorama.summarySourceCount', { count: imageCount ?? 0 })} - ${
    isSourceCountValid ? t('modals.panorama.summaryReady') : t('modals.panorama.summaryBlocked')
  }`;
  const stitchReadinessLabel = isEngineApplyReady
    ? t('modals.panorama.summaryReady')
    : t('modals.panorama.summaryBlocked');
  const seamReviewSummary = renderedReview?.seamReview ?? {
    policy: 'adaptive_dp_feather_v1' as const,
    reviewStatus: 'requires_review' as const,
    seamCount: Math.max(0, (imageCount ?? 0) - 1),
    seams: [],
  };
  const sourceContributionSummary = renderedReview?.sourceContribution ?? {
    excludedSourceCount: 0,
    regions: Array.from({ length: imageCount ?? 0 }, (_, sourceIndex) => ({
      coverageRatio: 1 / Math.max(1, imageCount ?? 1),
      role: 'stitched' as const,
      sourceIndex,
    })),
    stitchedSourceCount: imageCount ?? 0,
  };
  const exposureSummary = renderedReview?.exposureNormalizationSummary ?? {
    appliedGainCount: 0,
    appliedLuminanceGains: [],
    mode: 'none' as const,
  };
  const exposureDeltaLabel =
    exposureSummary.medianLogLuminanceDeltaBefore === undefined ||
    exposureSummary.medianLogLuminanceDeltaAfter === undefined
      ? t('modals.panorama.summaryBlocked')
      : t('modals.panorama.review.exposureDeltaValue', {
          after: exposureSummary.medianLogLuminanceDeltaAfter.toFixed(3),
          before: exposureSummary.medianLogLuminanceDeltaBefore.toFixed(3),
        });
  const exposureGainLabel =
    exposureSummary.appliedLuminanceGains.length === 0
      ? t('modals.panorama.review.exposureGainCount', { count: exposureSummary.appliedGainCount })
      : exposureSummary.appliedLuminanceGains
          .map((gain) => `S${gain.sourceIndex + 1} ${gain.gain.toFixed(3)}x`)
          .join(' / ');
  const seamMaxP95ErrorPx =
    seamReviewSummary.seams.length === 0 ? 0 : Math.max(...seamReviewSummary.seams.map((seam) => seam.p95ErrorPx));
  const lowConfidenceSeamCount = seamReviewSummary.seams.filter((seam) => seam.confidence === 'low').length;
  const inlierEdgeCount = seamReviewSummary.seams.filter((seam) => seam.confidence !== 'low').length;
  const cropCoveragePercent =
    renderedReview === null
      ? null
      : Math.round(
          (renderedReview.boundary.crop.width * renderedReview.boundary.crop.height * 100) /
            (renderedReview.boundary.crop.preCropWidth * renderedReview.boundary.crop.preCropHeight),
        );
  const cropCoverageLabel =
    cropCoveragePercent === null
      ? t('modals.panorama.summaryBlocked')
      : t('modals.panorama.review.cropCoveragePercent', { value: cropCoveragePercent });
  const derivedOutputReceipt =
    savedReviewSummary === null
      ? null
      : buildPanoramaDerivedOutputReceipt({
          acceptedDryRunPlanHash: lastApplyCommand?.acceptedDryRunPlanHash,
          acceptedDryRunPlanId: lastApplyCommand?.acceptedDryRunPlanId,
          review: savedReviewSummary,
          settings,
        });
  const storedDerivedOutputReceipt =
    useUIStore((state) =>
      savedDerivedOutputReceiptId === null ? undefined : state.derivedOutputReceipts[savedDerivedOutputReceiptId],
    ) ?? derivedOutputReceipt;
  const upsertDerivedOutputReceipt = useUIStore((state) => state.upsertDerivedOutputReceipt);
  const currentDerivedOutputReceipt = useMemo(() => {
    if (savedPath === null || renderedReview === null) return null;
    return buildPanoramaDerivedOutputReceipt({
      acceptedDryRunPlanHash: lastApplyCommand?.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: lastApplyCommand?.acceptedDryRunPlanId,
      review: buildPanoramaSavedReviewSummary({
        outputPath: savedPath,
        renderedReview,
        settings,
        sourcePaths,
      }),
      settings,
    });
  }, [
    lastApplyCommand?.acceptedDryRunPlanHash,
    lastApplyCommand?.acceptedDryRunPlanId,
    renderedReview,
    savedPath,
    settings,
    sourcePaths,
  ]);
  const visibleDerivedOutputReceipt =
    storedDerivedOutputReceipt && currentDerivedOutputReceipt
      ? deriveDerivedOutputReceiptState({
          current: currentDerivedOutputReceipt,
          receipt: storedDerivedOutputReceipt,
        })
      : storedDerivedOutputReceipt;

  const setSetting = useCallback(
    (patch: Partial<PanoramaUiSettings>) => {
      onSettingsChange({ ...settings, ...patch });
    },
    [onSettingsChange, settings],
  );

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setSavedPath(null);
        setSavedReviewSummary(null);
        setSavedDerivedOutputReceiptId(null);
        setIsSaving(false);
      }, 300);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    onClose();
  }, [onClose, isSaving]);

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    mouseDownTarget.current = e.target;
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) {
      handleClose();
    }
    mouseDownTarget.current = null;
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const path = await onSave();
      if (renderedReview !== null) {
        const review = buildPanoramaSavedReviewSummary({
          outputPath: path,
          renderedReview,
          settings,
          sourcePaths,
        });
        const receipt = buildPanoramaDerivedOutputReceipt({
          acceptedDryRunPlanHash: lastApplyCommand?.acceptedDryRunPlanHash,
          acceptedDryRunPlanId: lastApplyCommand?.acceptedDryRunPlanId,
          review,
          settings,
        });
        upsertDerivedOutputReceipt(receipt);
        setSavedReviewSummary(review);
        setSavedDerivedOutputReceiptId(receipt.receiptId);
      }
      setSavedPath(path);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpen = () => {
    const openPath = visibleDerivedOutputReceipt?.openInEditorAction.path ?? savedPath;
    if (openPath) {
      onOpenFile(openPath);
      handleClose();
    }
  };

  const handleRun = () => {
    setSavedPath(null);
    setSavedReviewSummary(null);
    setSavedDerivedOutputReceiptId(null);
    onStitch();
  };

  const renderContent = () => {
    if (error) {
      return <MergeErrorState error={error} title={t('modals.panorama.failed')} />;
    }

    if (finalImageBase64 && !isProcessing) {
      return (
        <div>
          <MergeResultPreview
            alt={t('modals.panorama.stitchedAlt')}
            imageBase64={finalImageBase64}
            savedPath={savedPath}
            savedSuccessLabel={t('modals.panorama.savedSuccess')}
          />
          {lastApplyCommand && (
            <section
              className="mx-auto mt-4 grid max-w-2xl grid-cols-3 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-left"
              data-accepted-dry-run-plan-hash={lastApplyCommand.acceptedDryRunPlanHash}
              data-accepted-dry-run-plan-id={lastApplyCommand.acceptedDryRunPlanId}
              data-command-type={lastApplyCommand.commandType}
              data-dry-run={String(lastApplyCommand.dryRun)}
              data-source-count={lastApplyCommand.sourceCount}
              data-testid="panorama-apply-command-state"
              data-tool-name={lastApplyCommand.toolName}
            >
              {[
                {
                  label: t('modals.panorama.dryRunCommandTool'),
                  value: lastApplyCommand.toolName,
                },
                {
                  label: t('modals.panorama.summaryQuality'),
                  value: t('modals.panorama.summaryReady'),
                },
                {
                  label: t('modals.panorama.review.projectionCrop'),
                  value: lastApplyCommand.acceptedDryRunPlanId,
                },
              ].map((item) => (
                <div className="min-w-0 rounded border border-border-color bg-surface px-2 py-1.5" key={item.label}>
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
          {savedReviewSummary && (
            <section
              className="mx-auto mt-4 grid max-w-2xl grid-cols-5 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-left"
              data-boundary-mode={savedReviewSummary.boundaryMode}
              data-capability-level={savedReviewSummary.capabilityLevel}
              data-crop-rectangle={`${savedReviewSummary.crop.x},${savedReviewSummary.crop.y},${savedReviewSummary.crop.width},${savedReviewSummary.crop.height}`}
              data-manual-crop-insets={`${settings.manualCropInsetsPercent.top},${settings.manualCropInsetsPercent.right},${settings.manualCropInsetsPercent.bottom},${settings.manualCropInsetsPercent.left}`}
              data-output-dimensions={`${savedReviewSummary.outputDimensions.width} x ${savedReviewSummary.outputDimensions.height}`}
              data-output-path={savedReviewSummary.outputPath}
              data-overlap-feather-px={settings.overlapFeatherPx}
              data-projection={savedReviewSummary.projection}
              data-seam-max-p95-error-px={
                savedReviewSummary.seamReview.seams.length === 0
                  ? 0
                  : Math.max(...savedReviewSummary.seamReview.seams.map((seam) => seam.p95ErrorPx))
              }
              data-seam-count={savedReviewSummary.seamReview.seamCount}
              data-seam-contribution-map-artifact-id={savedReviewSummary.seamReview.contributionMapArtifactId ?? ''}
              data-seam-mask-artifact-id={savedReviewSummary.seamReview.seamMaskArtifactId ?? ''}
              data-seam-review-status={savedReviewSummary.seamReview.reviewStatus}
              data-exposure-applied-gain-count={savedReviewSummary.exposureNormalizationSummary.appliedGainCount}
              data-exposure-gains={savedReviewSummary.exposureNormalizationSummary.appliedLuminanceGains
                .map((gain) => `${gain.sourceIndex}:${gain.gain}`)
                .join(',')}
              data-exposure-median-log-luminance-delta-after={
                savedReviewSummary.exposureNormalizationSummary.medianLogLuminanceDeltaAfter ?? ''
              }
              data-exposure-median-log-luminance-delta-before={
                savedReviewSummary.exposureNormalizationSummary.medianLogLuminanceDeltaBefore ?? ''
              }
              data-source-contribution-regions={savedReviewSummary.sourceContribution.regions.length}
              data-source-excluded-count={savedReviewSummary.sourceContribution.excludedSourceCount}
              data-source-count={savedReviewSummary.sourceCount}
              data-source-graph-revisions={savedReviewSummary.sourceRefs
                .map((source) => source.graphRevision)
                .join(',')}
              data-source-paths={savedReviewSummary.sourceRefs.map((source) => source.path).join(',')}
              data-testid="panorama-saved-review-summary"
              data-warning-codes={savedReviewSummary.warningCodes.join(',')}
            >
              {[
                {
                  label: t('modals.panorama.summaryProjection'),
                  value: selectedProjectionLabel,
                },
                {
                  label: t('modals.panorama.summaryBoundary'),
                  value: selectedBoundaryLabel,
                },
                {
                  label: t('modals.panorama.review.projectionCrop'),
                  value: `${savedReviewSummary.crop.x}, ${savedReviewSummary.crop.y} - ${savedReviewSummary.crop.width} x ${savedReviewSummary.crop.height}`,
                },
                {
                  label: t('modals.panorama.summaryWorkload'),
                  value: `${savedReviewSummary.outputDimensions.width} x ${savedReviewSummary.outputDimensions.height}`,
                },
                {
                  label: t('modals.panorama.summarySources'),
                  value: t('modals.panorama.summarySourceCount', { count: savedReviewSummary.sourceCount }),
                },
                {
                  label: t('modals.panorama.review.seams'),
                  value: t('modals.panorama.review.seamCount', { count: savedReviewSummary.seamReview.seamCount }),
                },
                {
                  label: t('modals.panorama.review.sourceContribution'),
                  value: t('modals.panorama.review.sourceContributionCount', {
                    count: savedReviewSummary.sourceContribution.regions.length,
                  }),
                },
                {
                  label: t('modals.panorama.summaryExposure'),
                  value:
                    savedReviewSummary.exposureNormalizationSummary.appliedLuminanceGains.length === 0
                      ? t('modals.panorama.review.exposureGainCount', {
                          count: savedReviewSummary.exposureNormalizationSummary.appliedGainCount,
                        })
                      : savedReviewSummary.exposureNormalizationSummary.appliedLuminanceGains
                          .map((gain) => `S${gain.sourceIndex + 1} ${gain.gain.toFixed(3)}x`)
                          .join(' / '),
                },
              ].map((item) => (
                <div className="min-w-0 rounded border border-border-color bg-surface px-2 py-1.5" key={item.label}>
                  <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
                    {item.label}
                  </UiText>
                  <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                    {item.value}
                  </UiText>
                </div>
              ))}
              <UiText
                as="p"
                variant={TextVariants.small}
                color={TextColors.secondary}
                className="col-span-5 leading-relaxed"
              >
                {t('modals.panorama.uiOnlyNotice')}
              </UiText>
            </section>
          )}
          {visibleDerivedOutputReceipt ? (
            <div
              className="mx-auto mt-4 max-w-2xl text-left"
              data-derived-output-receipt-id={visibleDerivedOutputReceipt.receiptId}
              data-panorama-derived-source-open-path={visibleDerivedOutputReceipt.openInEditorAction.path ?? ''}
              data-panorama-derived-source-state={visibleDerivedOutputReceipt.openInEditorAction.state}
              data-testid="panorama-derived-output-receipt-store-entry"
            >
              <DerivedOutputReceiptPanel
                receipt={visibleDerivedOutputReceipt}
                onOpenOutput={onOpenFile}
                onExportOutput={onOpenFile}
                sourceLineageSummary={`${visibleDerivedOutputReceipt.sourceCount} sources / ${visibleDerivedOutputReceipt.sourceGraphRevisions
                  .slice(0, 3)
                  .join(', ')}`}
                validationStatus={visibleDerivedOutputReceipt.staleState === 'stale' ? 'needs_review' : 'passed'}
                validationStatusLabel={
                  visibleDerivedOutputReceipt.staleState === 'stale'
                    ? t('modals.derivedOutput.validationValue.needs_review')
                    : t('modals.panorama.review.proofStatus')
                }
                warnings={savedReviewSummary?.warningCodes ?? []}
              />
            </div>
          ) : null}
        </div>
      );
    }

    if (isProcessing) {
      return (
        <MergeProcessingState
          initialLabel={t('modals.panorama.initializing')}
          loadingImageUrl={loadingImageUrl}
          progressMessage={progressMessage}
          sourcePreviewAlt={t('modals.common.sourcePreviewAlt')}
          speedNotice={t('modals.panorama.speedNotice')}
          title={t('modals.panorama.stitchingProgress')}
        >
          {lastDryRunCommand && (
            <section
              className="mt-4 grid grid-cols-3 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-3 text-xs"
              data-command-type={lastDryRunCommand.commandType}
              data-dry-run={String(lastDryRunCommand.dryRun)}
              data-source-count={lastDryRunCommand.sourceCount}
              data-testid="panorama-dry-run-command-state"
              data-tool-name={lastDryRunCommand.appServerToolName}
            >
              {[
                {
                  label: t('modals.panorama.dryRunCommandTool'),
                  value: lastDryRunCommand.appServerToolName,
                },
                {
                  label: t('modals.panorama.dryRunCommandSources'),
                  value: t('modals.panorama.summarySourceCount', { count: lastDryRunCommand.sourceCount }),
                },
                {
                  label: t('modals.panorama.dryRunCommandMode'),
                  value: t('modals.panorama.dryRunCommandModeValue'),
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
        </MergeProcessingState>
      );
    }

    return (
      <div className="grid h-[520px] grid-cols-[minmax(260px,0.9fr)_minmax(360px,1.1fr)] overflow-hidden rounded-lg border border-surface">
        <div className="relative bg-[#0d0d0d]">
          {loadingImageUrl ? (
            <img
              src={loadingImageUrl}
              alt={t('modals.common.sourcePreviewAlt')}
              className="h-full w-full object-cover opacity-75"
            />
          ) : (
            <div className="h-full w-full bg-bg-primary" />
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-black/30" />
          {isSourceCountValid && (
            <div
              className="pointer-events-none absolute inset-0"
              data-review-status={seamReviewSummary.reviewStatus}
              data-seam-count={seamReviewSummary.seamCount}
              data-source-contribution-count={sourceContributionSummary.regions.length}
              data-testid="panorama-seam-contribution-overlay"
            >
              {Array.from({ length: Math.max(1, seamReviewSummary.seamCount) }, (_, index) => index).map((index) => (
                <div
                  className="absolute top-[16%] h-[68%] w-px rounded-full bg-cyan-200/75 shadow-[0_0_16px_rgba(125,211,252,0.75)]"
                  data-testid="panorama-seam-line"
                  key={index}
                  style={{ left: `${22 + index * 14}%` }}
                />
              ))}
              <div className="absolute left-5 top-5 flex max-w-[70%] flex-wrap gap-1.5">
                {sourceContributionSummary.regions.slice(0, 5).map((region) => (
                  <span
                    className="rounded border border-white/25 bg-black/55 px-2 py-1 text-[11px] font-medium text-white"
                    data-source-index={region.sourceIndex}
                    data-testid="panorama-source-contribution-chip"
                    key={region.sourceIndex}
                  >
                    {t('modals.panorama.review.sourceChip', {
                      index: region.sourceIndex + 1,
                      value: Math.round(region.coverageRatio * 100),
                    })}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="absolute bottom-6 left-6 right-6">
            <UiText as="div" variant={TextVariants.title} className="mb-3 flex items-center gap-2 text-white">
              <Layers className="w-6 h-6 text-accent" />
              <span>{t('modals.panorama.title')}</span>
            </UiText>
            <UiText className="text-white/80 leading-relaxed">
              {imageCount ? t('modals.panorama.descCount', { count: imageCount }) : t('modals.panorama.descGeneric')}
            </UiText>
          </div>
        </div>
        <div className="min-w-0 overflow-y-auto bg-bg-primary p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <UiText variant={TextVariants.title}>{t('modals.panorama.workflowTitle')}</UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                {t('modals.panorama.workflowStatus')}
              </UiText>
            </div>
            <ComputationalMergeAppServerBadge family="panorama" statusLabel={t('editor.ai.connection.ready')} />
          </div>
          <section
            className="mb-5 grid grid-cols-3 gap-2 rounded-md border border-border-color bg-surface p-3 text-xs"
            data-estimated-preview-memory-mb={estimatedPreviewMemoryMb}
            data-estimated-preview-megapixels={estimatedPreviewMegapixels}
            data-preview-source-count={imageCount ?? 0}
            data-testid="panorama-setup-summary"
          >
            {[
              {
                label: t('modals.panorama.summarySources'),
                value: sourceReadinessLabel,
              },
              {
                label: t('modals.panorama.summaryProjection'),
                value: selectedProjectionLabel,
              },
              {
                label: t('modals.panorama.summaryBlend'),
                value: t(`modals.panorama.blend.${settings.blendMode}.label`),
              },
              {
                label: t('modals.panorama.summaryBoundary'),
                value: selectedBoundaryLabel,
              },
              {
                label: t('modals.panorama.manualCrop.label'),
                value: manualCropLabel,
              },
              {
                label: t('modals.panorama.overlapFeather.label'),
                value: t('modals.panorama.overlapFeather.value', { value: settings.overlapFeatherPx }),
              },
              {
                label: t('modals.panorama.summaryExposure'),
                value: selectedExposureLabel,
              },
              {
                label: t('modals.panorama.summaryQuality'),
                value: selectedQualityLabel,
              },
              {
                label: t('modals.panorama.summaryPreviewBudget'),
                value: t('modals.panorama.previewPixels', { value: settings.maxPreviewDimensionPx }),
              },
              {
                label: t('modals.panorama.summaryWorkload'),
                value: t('modals.panorama.previewWorkload', { value: estimatedPreviewMegapixels }),
              },
              {
                label: t('modals.panorama.summaryMemory'),
                value: t('modals.panorama.previewMemory', { value: estimatedPreviewMemoryMb }),
              },
            ].map((item) => (
              <div
                className="rounded border border-border-color bg-bg-primary px-2 py-1.5"
                data-testid="panorama-setup-summary-chip"
                key={item.label}
              >
                <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
                  {item.label}
                </UiText>
                <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                  {item.value}
                </UiText>
              </div>
            ))}
          </section>
          <section
            className="mb-5 grid grid-cols-4 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-2 text-xs"
            data-boundary-mode={settings.boundaryMode}
            data-exposure-mode={settings.exposureMode}
            data-manual-crop-insets={`${settings.manualCropInsetsPercent.top},${settings.manualCropInsetsPercent.right},${settings.manualCropInsetsPercent.bottom},${settings.manualCropInsetsPercent.left}`}
            data-overlap-feather-px={settings.overlapFeatherPx}
            data-projection={settings.projection}
            data-seam-exposure-compensation-percent={settings.seamExposureCompensationPercent}
            data-source-count={imageCount ?? 0}
            data-engine-apply-ready={String(isEngineApplyReady)}
            data-stitch-ready={String(isEngineApplyReady)}
            data-testid="panorama-stitch-readiness-summary"
          >
            {[
              {
                label: t('modals.panorama.summarySources'),
                value: t('modals.panorama.summarySourceCount', { count: imageCount ?? 0 }),
              },
              {
                label: t('modals.panorama.summaryExposure'),
                value: selectedExposureLabel,
              },
              {
                label: t('modals.panorama.summaryBoundary'),
                value: selectedBoundaryLabel,
              },
              {
                label: t('modals.panorama.summaryQuality'),
                value: stitchReadinessLabel,
              },
            ].map((item) => (
              <div
                className={`rounded border px-2 py-1.5 ${
                  item.value === stitchReadinessLabel && !isSourceCountValid
                    ? 'border-red-500/40 bg-red-500/10'
                    : 'border-border-color bg-bg-primary'
                }`}
                data-testid="panorama-stitch-readiness-chip"
                key={item.label}
              >
                <UiText as="span" variant={TextVariants.small} className="block truncate text-text-tertiary">
                  {item.label}
                </UiText>
                <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                  {item.value}
                </UiText>
              </div>
            ))}
          </section>

          <section
            className="mb-5 grid grid-cols-3 gap-2 rounded-md border border-border-color bg-surface p-3 text-xs"
            data-boundary-mode={settings.boundaryMode}
            data-execution-mode={runtimePlan?.preflight.execution_mode ?? ''}
            data-memory-budget-ratio={runtimePlan?.preflight.memory_budget_ratio ?? ''}
            data-output-dimensions={runtimePlanOutput}
            data-plan-scope="tile_runtime_output"
            data-plan-status={runtimePlan?.preflight.status ?? 'pending'}
            data-projection={settings.projection}
            data-runtime-plan-ready={String(runtimePlan !== null)}
            data-source-geometry-layout={runtimePlanSourceGeometry?.layout ?? 'pending'}
            data-source-geometry-support={runtimePlanSourceGeometry?.support ?? 'pending'}
            data-source-row-count-estimate={runtimePlanSourceGeometry?.row_count_estimate ?? ''}
            data-source-vertical-span-px={runtimePlanSourceGeometry?.vertical_span_px ?? ''}
            data-testid="panorama-runtime-plan-summary"
            data-tile-count={runtimePlanTileCount ?? ''}
          >
            {[
              {
                label: t('modals.panorama.summaryQuality'),
                value: runtimePlanStatus,
              },
              {
                label: t('modals.panorama.summaryWorkload'),
                value: runtimePlanWorkload,
              },
              {
                label: t('modals.panorama.summaryMemory'),
                value:
                  runtimePlanMemoryMb === null
                    ? t('modals.panorama.summaryBlocked')
                    : t('modals.panorama.previewMemory', { value: runtimePlanMemoryMb }),
              },
            ].map((item) => (
              <div
                className="rounded border border-border-color bg-bg-primary px-2 py-1.5"
                data-testid="panorama-runtime-plan-summary-chip"
                key={item.label}
              >
                <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
                  {item.label}
                </UiText>
                <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                  {item.value}
                </UiText>
              </div>
            ))}
          </section>

          <section
            className="mb-5 grid grid-cols-4 gap-2 rounded-md border border-border-color bg-surface p-3 text-xs"
            data-crop-coverage-percent={cropCoveragePercent ?? ''}
            data-excluded-source-count={sourceContributionSummary.excludedSourceCount}
            data-exposure-applied-gain-count={exposureSummary.appliedGainCount}
            data-exposure-gains={exposureSummary.appliedLuminanceGains
              .map((gain) => `${gain.sourceIndex}:${gain.gain}`)
              .join(',')}
            data-exposure-median-log-luminance-delta-after={exposureSummary.medianLogLuminanceDeltaAfter ?? ''}
            data-exposure-median-log-luminance-delta-before={exposureSummary.medianLogLuminanceDeltaBefore ?? ''}
            data-inlier-edge-count={inlierEdgeCount}
            data-low-confidence-seam-count={lowConfidenceSeamCount}
            data-seam-count={seamReviewSummary.seamCount}
            data-seam-max-p95-error-px={seamMaxP95ErrorPx}
            data-seam-review-status={seamReviewSummary.reviewStatus}
            data-stitched-source-count={sourceContributionSummary.stitchedSourceCount}
            data-testid="panorama-quality-diagnostics"
            data-warning-codes={renderedReview?.warningCodes.join(',') ?? ''}
          >
            {[
              {
                label: t('modals.panorama.review.maxSeamError'),
                value: t('modals.panorama.review.maxSeamErrorValue', { value: seamMaxP95ErrorPx.toFixed(1) }),
              },
              {
                label: t('modals.panorama.review.inlierEdges'),
                value: t('modals.panorama.review.inlierEdgesValue', { count: inlierEdgeCount }),
              },
              {
                label: t('modals.panorama.review.cropCoverage'),
                value: cropCoverageLabel,
              },
              {
                label: t('modals.panorama.review.sourceUsage'),
                value: t('modals.panorama.review.sourceUsageValue', {
                  excluded: sourceContributionSummary.excludedSourceCount,
                  stitched: sourceContributionSummary.stitchedSourceCount,
                }),
              },
              {
                label: t('modals.panorama.review.exposureGains'),
                value: exposureGainLabel,
              },
              {
                label: t('modals.panorama.review.exposureDelta'),
                value: exposureDeltaLabel,
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

          {!isSourceCountValid && (
            <div className="mb-5 flex gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <UiText className="leading-relaxed">{t('modals.panorama.sourceCountBlocked')}</UiText>
            </div>
          )}
          {isSourceCountValid && !isEngineApplyReady && (
            <div
              className="mb-5 flex gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3"
              data-testid="panorama-engine-capability-blocker"
            >
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
              <UiText className="leading-relaxed">{t('modals.panorama.engineCapabilityBlocked')}</UiText>
            </div>
          )}

          <section className="grid grid-cols-2 gap-4">
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.panorama.projectionLabel')}
              </UiText>
              <div className="grid gap-2" data-testid="panorama-projection-options">
                {projectionOptions.map((option) => {
                  const isSupported = option.value === 'rectilinear' || option.value === 'cylindrical';
                  const isSelected = settings.projection === option.value;
                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? 'border-accent bg-accent/15 text-text-primary'
                          : 'border-border-color bg-surface text-text-secondary hover:bg-card-active'
                      } disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-surface`}
                      data-engine-supported={String(isSupported)}
                      data-testid={`panorama-projection-option-${option.value}`}
                      disabled={!isSupported}
                      key={option.value}
                      onClick={() => {
                        setSetting({ projection: option.value });
                      }}
                      type="button"
                    >
                      <span className="block font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-text-tertiary">
                        {isSupported ? t('modals.panorama.engineSupported') : t('modals.panorama.engineUnsupported')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.panorama.qualityLabel')}
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

          <section className="mt-5">
            <UiText variant={TextVariants.heading} className="mb-3">
              {t('modals.panorama.blendLabel')}
            </UiText>
            <div className="grid grid-cols-2 gap-2">
              {(['multi_band', 'feather'] as const).map((blendMode: PanoramaUiBlendMode) => (
                <button
                  key={blendMode}
                  className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                    settings.blendMode === blendMode
                      ? 'border-accent bg-accent/15'
                      : 'border-border-color bg-surface hover:bg-card-active'
                  }`}
                  onClick={() => {
                    setSetting({ blendMode });
                  }}
                  type="button"
                >
                  <UiText as="span" variant={TextVariants.label}>
                    {t(`modals.panorama.blend.${blendMode}.label`)}
                  </UiText>
                  <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                    {t(`modals.panorama.blend.${blendMode}.status`)}
                  </UiText>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.panorama.boundaryLabel')}
              </UiText>
              <div className="grid gap-2" data-testid="panorama-boundary-options">
                {boundaryOptions.map((option) => {
                  const isSupported = option.value === 'auto_crop' || option.value === 'manual_crop';
                  const isSelected = settings.boundaryMode === option.value;
                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? 'border-accent bg-accent/15 text-text-primary'
                          : 'border-border-color bg-surface text-text-secondary hover:bg-card-active'
                      } disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-surface`}
                      data-engine-supported={String(isSupported)}
                      data-testid={`panorama-boundary-option-${option.value}`}
                      disabled={!isSupported}
                      key={option.value}
                      onClick={() => {
                        setSetting({ boundaryMode: option.value });
                      }}
                      type="button"
                    >
                      <span className="block font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-text-tertiary">
                        {isSupported ? t('modals.panorama.engineSupported') : t('modals.panorama.engineUnsupported')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.panorama.exposureLabel')}
              </UiText>
              <Dropdown
                options={exposureOptions}
                value={settings.exposureMode}
                onChange={(exposureMode) => {
                  setSetting({ exposureMode });
                }}
              />
              <div className="mt-3" data-testid="panorama-seam-exposure-control">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
                    {t('modals.panorama.seamExposureCompensationLabel')}
                  </UiText>
                  <UiText
                    as="span"
                    variant={TextVariants.small}
                    color={TextColors.secondary}
                    data-testid="panorama-seam-exposure-compensation-value"
                  >
                    {t('modals.panorama.seamExposureCompensationValue', {
                      value: settings.seamExposureCompensationPercent,
                    })}
                  </UiText>
                </div>
                <input
                  className="w-full accent-accent"
                  data-testid="panorama-seam-exposure-compensation-slider"
                  max={100}
                  min={0}
                  onChange={(event) => {
                    setSetting({ seamExposureCompensationPercent: Number(event.target.value) });
                  }}
                  step={5}
                  type="range"
                  value={settings.seamExposureCompensationPercent}
                />
              </div>
            </div>
          </section>

          <section
            className="mt-5 rounded-md border border-border-color bg-surface p-3"
            data-manual-crop-insets={`${settings.manualCropInsetsPercent.top},${settings.manualCropInsetsPercent.right},${settings.manualCropInsetsPercent.bottom},${settings.manualCropInsetsPercent.left}`}
            data-overlap-feather-px={settings.overlapFeatherPx}
            data-testid="panorama-boundary-refinement"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <UiText variant={TextVariants.heading}>{t('modals.panorama.boundaryRefinementLabel')}</UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary}>
                {manualCropLabel}
              </UiText>
            </div>
            <div className="grid grid-cols-2 gap-3" data-testid="panorama-manual-crop-controls">
              {manualCropInsetControls.map((control) => (
                <div className="block" key={control.key}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
                      {control.label}
                    </UiText>
                    <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
                      {settings.manualCropInsetsPercent[control.key]}%
                    </UiText>
                  </div>
                  <input
                    aria-label={control.label}
                    className="w-full accent-accent"
                    data-testid={`panorama-manual-crop-${control.key}`}
                    max={40}
                    min={0}
                    onChange={(event) => {
                      setSetting({
                        boundaryMode: 'manual_crop',
                        manualCropInsetsPercent: {
                          ...settings.manualCropInsetsPercent,
                          [control.key]: Number(event.target.value),
                        },
                      });
                    }}
                    step={1}
                    type="range"
                    value={settings.manualCropInsetsPercent[control.key]}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3" data-testid="panorama-overlap-feather-control">
              <div className="mb-1 flex items-center justify-between gap-3">
                <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
                  {t('modals.panorama.overlapFeather.label')}
                </UiText>
                <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
                  {t('modals.panorama.overlapFeather.value', { value: settings.overlapFeatherPx })}
                </UiText>
              </div>
              <input
                className="w-full accent-accent"
                data-testid="panorama-overlap-feather-slider"
                max={512}
                min={0}
                onChange={(event) => {
                  setSetting({ overlapFeatherPx: Number(event.target.value) });
                }}
                step={8}
                type="range"
                value={settings.overlapFeatherPx}
              />
            </div>
          </section>

          <section className="mt-5">
            <UiText variant={TextVariants.heading} className="mb-3">
              {t('modals.panorama.previewBudgetLabel')}
            </UiText>
            <div className="grid grid-cols-3 gap-2">
              {[2400, 4096, 8192].map((maxPreviewDimensionPx) => (
                <button
                  key={maxPreviewDimensionPx}
                  className={`h-10 rounded-md border text-sm transition-colors ${
                    settings.maxPreviewDimensionPx === maxPreviewDimensionPx
                      ? 'border-accent bg-accent/15 text-text-primary'
                      : 'border-border-color bg-surface text-text-secondary hover:bg-card-active'
                  }`}
                  onClick={() => {
                    setSetting({ maxPreviewDimensionPx });
                  }}
                  type="button"
                >
                  {t('modals.panorama.previewPixels', { value: maxPreviewDimensionPx })}
                </button>
              ))}
            </div>
          </section>

          <div className="mt-5">
            <ComputationalMergeReviewPanel
              title={t('modals.panorama.review.title')}
              proofStatus={t('modals.panorama.review.proofStatus')}
              limitation={t('modals.panorama.review.limitation')}
              testId="panorama-review-diagnostics"
              items={[
                {
                  label: t('modals.panorama.review.alignment'),
                  status: 'ready',
                  value: t('modals.panorama.review.runtimeBridge'),
                },
                {
                  label: t('modals.panorama.review.seams'),
                  status: 'review',
                  value: t('modals.panorama.review.seamCount', { count: seamReviewSummary.seamCount }),
                },
                {
                  label: t('modals.panorama.review.sourceContribution'),
                  status: 'review',
                  value: t('modals.panorama.review.sourceContributionCount', {
                    count: sourceContributionSummary.regions.length,
                  }),
                },
                {
                  label: t('modals.panorama.review.exposureGains'),
                  status: exposureSummary.mode === 'none' ? 'review' : 'ready',
                  value: exposureGainLabel,
                },
                {
                  label: t('modals.panorama.review.projectionCrop'),
                  status: isEngineApplyReady ? 'ready' : 'review',
                  value: isEngineApplyReady
                    ? t('modals.panorama.review.runtimeAutoCrop')
                    : t('modals.panorama.review.engineCapabilityBlocked'),
                },
              ]}
              sections={[
                {
                  title: t('modals.panorama.workflowTitle'),
                  rows: [
                    {
                      label: t('modals.panorama.summarySources'),
                      value: sourceReadinessLabel,
                    },
                    {
                      label: t('modals.panorama.projectionLabel'),
                      value: selectedProjectionLabel,
                    },
                    {
                      label: t('modals.panorama.boundaryLabel'),
                      value: selectedBoundaryLabel,
                    },
                    {
                      label: t('modals.panorama.exposureLabel'),
                      value: selectedExposureLabel,
                    },
                    {
                      label: t('modals.panorama.seamExposureCompensationLabel'),
                      value: t('modals.panorama.seamExposureCompensationValue', {
                        value: settings.seamExposureCompensationPercent,
                      }),
                    },
                    {
                      label: t('modals.panorama.previewBudgetLabel'),
                      value: t('modals.panorama.previewPixels', { value: settings.maxPreviewDimensionPx }),
                    },
                  ],
                },
                {
                  title: t('modals.panorama.review.title'),
                  rows: [
                    {
                      label: t('modals.panorama.review.seams'),
                      value: t('modals.panorama.review.seamCount', { count: seamReviewSummary.seamCount }),
                    },
                    {
                      label: t('modals.panorama.review.sourceContribution'),
                      value: t('modals.panorama.review.sourceContributionCount', {
                        count: sourceContributionSummary.regions.length,
                      }),
                    },
                    {
                      label: t('modals.panorama.review.exposureGains'),
                      value: exposureGainLabel,
                    },
                    {
                      label: t('modals.panorama.review.exposureDelta'),
                      value: exposureDeltaLabel,
                    },
                    {
                      label: t('modals.panorama.review.projectionCrop'),
                      value: isEngineApplyReady
                        ? t('modals.panorama.review.runtimeAutoCrop')
                        : t('modals.panorama.review.engineCapabilityBlocked'),
                    },
                  ],
                },
              ]}
            />
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-md border border-border-color bg-surface px-4 py-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="leading-relaxed">
              {t('modals.panorama.uiOnlyNotice')}
            </UiText>
          </div>
        </div>
      </div>
    );
  };

  const renderButtons = () => {
    return (
      <MergeFooterActions
        error={error}
        finalImageBase64={finalImageBase64}
        isProcessing={isProcessing}
        isSaving={isSaving}
        isSourceCountValid={isEngineApplyReady}
        labels={{
          cancel: t('modals.panorama.cancel'),
          close: t('modals.panorama.close'),
          openInEditor: t('modals.panorama.openInEditor'),
          retry: t('modals.panorama.retry'),
          save: t('modals.panorama.save'),
          start: t('modals.panorama.start'),
        }}
        onClose={handleClose}
        onOpen={handleOpen}
        onRun={handleRun}
        onSave={() => {
          void handleSave();
        }}
        savedPath={savedPath}
        StartIcon={Layers}
      />
    );
  };

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`bg-surface rounded-xl shadow-2xl p-6 w-full max-w-4xl max-h-[calc(100vh-48px)] transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        role="presentation"
      >
        <div className="flex max-h-[calc(100vh-96px)] min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">{renderContent()}</div>
          <div className={`mt-4 flex shrink-0 justify-end gap-3 ${savedPath ? '' : 'pt-4 border-t border-surface/50'}`}>
            {renderButtons()}
          </div>
        </div>
      </div>
    </div>
  );
}
