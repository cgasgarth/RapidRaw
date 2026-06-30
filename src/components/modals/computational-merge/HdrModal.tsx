import { CheckCircle, Images, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  HdrBracketDetectionMethodV1,
  HdrBracketSourceMetadataV1,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import {
  applyHdrToneMappingPreset,
  HDR_TONE_MAPPING_PRESETS,
  type HdrMergeAlignmentMode,
  type HdrMergeDeghosting,
  type HdrMergeExposureWeightingMode,
  type HdrMergeQualityPreference,
  type HdrMergeStrategy,
  type HdrMergeUiSettings,
  type HdrToneMappingPreset,
} from '../../../schemas/computational-merge/hdrMergeUiSchemas';
import { type HdrModalState, useUIStore } from '../../../store/useUIStore';
import { TextColors, TextVariants } from '../../../types/typography';
import { buildHdrDerivedOutputReceipt, deriveDerivedOutputReceiptState } from '../../../utils/derivedOutputReceipt';
import { buildHdrBracketPreflight, type HdrBracketPreflightSourceMetadata } from '../../../utils/hdrBracketPreflight';
import { buildHdrEditableHandoffSummary } from '../../../utils/hdrEditableHandoff';
import { buildHdrReviewDiagnostics } from '../../../utils/hdrReviewDiagnostics';
import Dropdown, { type OptionItem } from '../../ui/primitives/Dropdown';
import UiText from '../../ui/primitives/Text';
import ComputationalMergeAppServerBadge from './ComputationalMergeAppServerBadge';
import DerivedOutputReceiptPanel from './DerivedOutputReceiptPanel';
import { MergeErrorState, MergeFooterActions, MergeProcessingState, MergeResultPreview } from './MergeStatusViews';

interface HdrModalProps {
  error: string | null;
  finalImageBase64: string | null;
  imageCount?: number;
  isOpen: boolean;
  isProcessing: boolean;
  lastApplyCommand?: HdrModalState['lastApplyCommand'];
  lastDryRunCommand?: HdrModalState['lastDryRunCommand'];
  loadingImageUrl?: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onSave: () => Promise<string>;
  onSettingsChange: (settings: HdrMergeUiSettings) => void;
  onMerge: () => void;
  progressMessage: string | null;
  settings: HdrMergeUiSettings;
  sourceMetadata?: HdrBracketPreflightSourceMetadata[];
  sourcePaths?: string[];
}

export default function HdrModal({
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
  onMerge,
  progressMessage,
  settings,
  sourceMetadata,
  sourcePaths = [],
}: HdrModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [savedHandoffSummary, setSavedHandoffSummary] = useState<HdrModalState['savedHandoffSummary']>(null);
  const [savedDerivedOutputReceiptId, setSavedDerivedOutputReceiptId] = useState<string | null>(null);

  const mouseDownTarget = useRef<EventTarget | null>(null);
  const isSourceCountValid = (imageCount ?? 0) >= 2;
  const bracketPreflight = buildHdrBracketPreflight(sourceMetadata);
  const isBracketBlocked =
    bracketPreflight !== null && !bracketPreflight.accepted && settings.bracketValidation === 'required';

  const alignmentOptions: Array<OptionItem<HdrMergeAlignmentMode>> = [
    { label: t('modals.hdr.alignment.auto'), value: 'auto' },
    { label: t('modals.hdr.alignment.translation'), value: 'translation' },
    { label: t('modals.hdr.alignment.homography'), value: 'homography' },
    { label: t('modals.hdr.alignment.none'), value: 'none' },
  ];
  const qualityOptions: Array<OptionItem<HdrMergeQualityPreference>> = [
    { label: t('modals.hdr.quality.preview'), value: 'preview' },
    { label: t('modals.hdr.quality.balanced'), value: 'balanced' },
    { label: t('modals.hdr.quality.best'), value: 'best' },
  ];
  const strategyOptions: Array<OptionItem<HdrMergeStrategy>> = [
    { label: t('modals.hdr.strategy.sceneLinear'), value: 'scene_linear_radiance' },
    { label: t('modals.hdr.strategy.exposureFusion'), value: 'exposure_fusion_preview' },
  ];
  const getToneMappingPresetLabel = (preset: HdrToneMappingPreset) => {
    switch (preset) {
      case 'custom':
        return t('modals.hdr.toneMappingPreset.custom');
      case 'fast_preview':
        return t('modals.hdr.toneMappingPreset.fastPreview');
      case 'highlight_detail':
        return t('modals.hdr.toneMappingPreset.highlightDetail');
      case 'interior_lift':
        return t('modals.hdr.toneMappingPreset.interiorLift');
      case 'natural':
        return t('modals.hdr.toneMappingPreset.natural');
    }
  };
  const selectedAlignmentLabel =
    alignmentOptions.find((option) => option.value === settings.alignmentMode)?.label ?? '';
  const selectedQualityLabel =
    qualityOptions.find((option) => option.value === settings.qualityPreference)?.label ?? '';
  const selectedStrategyLabel = strategyOptions.find((option) => option.value === settings.mergeStrategy)?.label ?? '';
  const selectedPresetLabel = getToneMappingPresetLabel(settings.toneMappingPreset);
  const selectedSourceIndexes = new Set(settings.selectedSourceIndexes);
  const selectedSourceCount =
    bracketPreflight?.sourceMetadata.filter((source) => selectedSourceIndexes.has(source.sourceIndex)).length ??
    Math.min(imageCount ?? 0, settings.selectedSourceIndexes.length);
  const isSourceSelectionValid = selectedSourceCount >= 2;
  const isMergeReady = isSourceCountValid && isSourceSelectionValid && !isBracketBlocked;
  const estimatedPreviewMegapixels = Math.round(
    (selectedSourceCount * settings.maxPreviewDimensionPx ** 2) / 1_000_000,
  );
  const estimatedPreviewMemoryMb = Math.max(
    0,
    Math.round((selectedSourceCount * settings.maxPreviewDimensionPx ** 2 * 4) / 1_000_000),
  );
  const reviewDiagnostics = buildHdrReviewDiagnostics({
    bracketPreflight,
    imageCount: imageCount ?? 0,
    isMergeReady,
    settings,
  });
  const isDeghostReviewRequired = isMergeReady && settings.deghosting !== 'off';
  const [isDeghostReviewApproved, setIsDeghostReviewApproved] = useState(false);
  const isDeghostReviewResolved = !isDeghostReviewRequired || isDeghostReviewApproved;
  const isApplyReady = isMergeReady && isDeghostReviewResolved;
  const applyReadinessLabel = !isMergeReady
    ? t('modals.hdr.summaryBlocked')
    : isApplyReady
      ? t('modals.hdr.summaryReady')
      : t('modals.hdr.deghostReviewRequired');

  const setSetting = useCallback(
    (patch: Partial<HdrMergeUiSettings>) => {
      onSettingsChange({ ...settings, ...patch });
    },
    [onSettingsChange, settings],
  );
  const setManualSetting = useCallback(
    (patch: Partial<HdrMergeUiSettings>) => {
      setSetting({ ...patch, toneMappingPreset: 'custom' });
    },
    [setSetting],
  );
  const selectToneMappingPreset = useCallback(
    (preset: Exclude<HdrToneMappingPreset, 'custom'>) => {
      setIsDeghostReviewApproved(false);
      onSettingsChange(applyHdrToneMappingPreset(settings, preset));
    },
    [onSettingsChange, settings],
  );
  const bracketValidationLabel =
    settings.bracketValidation === 'required'
      ? t('modals.hdr.bracketValidation.required')
      : settings.bracketValidation === 'warn'
        ? t('modals.hdr.bracketValidation.warn')
        : t('modals.hdr.bracketValidation.disabled');
  const mergeReadinessLabel = isMergeReady ? t('modals.hdr.summaryReady') : t('modals.hdr.summaryBlocked');
  const getBracketDetectionMethodLabel = (method: HdrBracketDetectionMethodV1) => {
    switch (method) {
      case 'caller_declared_ev':
        return t('modals.hdr.bracketDetectionMethod.caller_declared_ev');
      case 'luminance_estimate':
        return t('modals.hdr.bracketDetectionMethod.luminance_estimate');
      case 'manual_order':
        return t('modals.hdr.bracketDetectionMethod.manual_order');
      case 'metadata_exposure_compensation':
        return t('modals.hdr.bracketDetectionMethod.metadata_exposure_compensation');
      case 'metadata_exposure_time_iso_aperture':
        return t('modals.hdr.bracketDetectionMethod.metadata_exposure_time_iso_aperture');
    }
  };
  const getBracketRoleLabel = (role: HdrBracketSourceMetadataV1['resolvedBracketRole']) => {
    switch (role) {
      case 'over_exposed':
        return t('modals.hdr.bracketRole.over_exposed');
      case 'reference':
        return t('modals.hdr.bracketRole.reference');
      case 'under_exposed':
        return t('modals.hdr.bracketRole.under_exposed');
      case 'unknown':
        return t('modals.hdr.bracketRole.unknown');
    }
  };
  const weightingOptions: Array<{
    label: string;
    value: HdrMergeExposureWeightingMode;
  }> = [
    { label: t('modals.hdr.exposureWeighting.balanced'), value: 'balanced' },
    { label: t('modals.hdr.exposureWeighting.protectHighlights'), value: 'protect_highlights' },
    { label: t('modals.hdr.exposureWeighting.liftShadows'), value: 'lift_shadows' },
  ];
  const getSourceWeightMultiplier = (source: HdrBracketSourceMetadataV1): number => {
    if (settings.exposureWeightingMode === 'protect_highlights' && source.resolvedBracketRole === 'under_exposed') {
      return 1.35;
    }
    if (settings.exposureWeightingMode === 'lift_shadows' && source.resolvedBracketRole === 'over_exposed') {
      return 1.35;
    }
    return 1;
  };
  const toggleSourceSelection = (sourceIndex: number) => {
    const next = new Set(settings.selectedSourceIndexes);
    if (next.has(sourceIndex) && next.size > 2) {
      next.delete(sourceIndex);
    } else {
      next.add(sourceIndex);
    }
    setManualSetting({ selectedSourceIndexes: [...next].sort((left, right) => left - right) });
  };
  const bracketPreflightStatus =
    bracketPreflight === null
      ? t('modals.hdr.bracketPreflightManual')
      : bracketPreflight.accepted
        ? t('modals.hdr.bracketPreflightAccepted')
        : settings.bracketValidation === 'required'
          ? t('modals.hdr.bracketPreflightBlocked')
          : t('modals.hdr.bracketPreflightWarning');
  const handoffSummary = savedHandoffSummary;
  const storedDerivedOutputReceipt = useUIStore((state) =>
    savedDerivedOutputReceiptId === null ? undefined : state.derivedOutputReceipts[savedDerivedOutputReceiptId],
  );
  const upsertDerivedOutputReceipt = useUIStore((state) => state.upsertDerivedOutputReceipt);
  const currentDerivedOutputReceipt = useMemo(() => {
    if (handoffSummary === null) return null;
    return buildHdrDerivedOutputReceipt({
      acceptedDryRunPlanHash: lastApplyCommand?.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: lastApplyCommand?.acceptedDryRunPlanId,
      handoff: buildHdrEditableHandoffSummary({
        deghostReviewAccepted: isDeghostReviewApproved,
        deghostReviewRequired: isDeghostReviewRequired,
        outputPath: handoffSummary.outputPath,
        settings,
        sourcePaths,
      }),
      settings,
    });
  }, [
    handoffSummary,
    isDeghostReviewApproved,
    isDeghostReviewRequired,
    lastApplyCommand?.acceptedDryRunPlanHash,
    lastApplyCommand?.acceptedDryRunPlanId,
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

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setSavedPath(null);
        setSavedHandoffSummary(null);
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
      const handoff = buildHdrEditableHandoffSummary({
        deghostReviewAccepted: isDeghostReviewApproved,
        deghostReviewRequired: isDeghostReviewRequired,
        outputPath: path,
        settings,
        sourcePaths,
      });
      const receipt = buildHdrDerivedOutputReceipt({
        acceptedDryRunPlanHash: lastApplyCommand?.acceptedDryRunPlanHash,
        acceptedDryRunPlanId: lastApplyCommand?.acceptedDryRunPlanId,
        handoff,
        settings,
      });
      upsertDerivedOutputReceipt(receipt);
      setSavedHandoffSummary(handoff);
      setSavedDerivedOutputReceiptId(receipt.receiptId);
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
    setSavedHandoffSummary(null);
    setSavedDerivedOutputReceiptId(null);
    onMerge();
  };

  const renderContent = () => {
    if (error) {
      return <MergeErrorState error={error} title={t('modals.hdr.failed')} />;
    }

    if (finalImageBase64 && !isProcessing) {
      return (
        <div>
          <MergeResultPreview
            alt={t('modals.hdr.mergedAlt')}
            imageBase64={finalImageBase64}
            savedPath={savedPath}
            savedSuccessLabel={t('modals.hdr.savedSuccess')}
          />
          {lastApplyCommand && (
            <section
              className="mx-auto mt-4 grid max-w-2xl grid-cols-3 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-left"
              data-accepted-dry-run-plan-hash={lastApplyCommand.acceptedDryRunPlanHash}
              data-accepted-dry-run-plan-id={lastApplyCommand.acceptedDryRunPlanId}
              data-command-type={lastApplyCommand.commandType}
              data-dry-run={String(lastApplyCommand.dryRun)}
              data-source-count={lastApplyCommand.sources}
              data-testid="hdr-apply-command-state"
              data-tool-name={lastApplyCommand.toolName}
            >
              {[
                {
                  label: t('modals.hdr.dryRunCommandTool'),
                  value: lastApplyCommand.toolName,
                },
                {
                  label: t('modals.hdr.summaryStartState'),
                  value: t('modals.hdr.summaryReady'),
                },
                {
                  label: t('modals.hdr.handoffEditableAsset'),
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
          {handoffSummary && (
            <section
              className="mx-auto mt-4 grid max-w-2xl grid-cols-3 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-left"
              data-capability-level={handoffSummary.capabilityLevel}
              data-deghost-review-accepted={String(handoffSummary.deghostReviewAccepted)}
              data-deghost-review-required={String(handoffSummary.deghostReviewRequired)}
              data-deghosting={handoffSummary.deghosting}
              data-display-preview-color-state={handoffSummary.displayPreviewColorState}
              data-editable-derived-asset-id={handoffSummary.editableDerivedAssetId}
              data-export-color-state={handoffSummary.exportColorState}
              data-merge-strategy={handoffSummary.mergeStrategy}
              data-output-color-space={handoffSummary.outputColorSpace}
              data-output-encoding={handoffSummary.outputEncoding}
              data-output-path={handoffSummary.outputPath}
              data-preview-export-compared-fields={handoffSummary.previewExportParity.comparedFields.join(',')}
              data-preview-export-export-receipt-hash={handoffSummary.previewExportParity.exportReceiptHash}
              data-preview-export-mean-abs-delta={handoffSummary.previewExportMeanAbsDelta}
              data-preview-export-parity-status={handoffSummary.previewExportParityStatus}
              data-preview-export-proof-hash={handoffSummary.previewExportParity.parityProofHash}
              data-preview-export-preview-state-hash={handoffSummary.previewExportParity.previewStateHash}
              data-preview-tone-mapped={String(handoffSummary.previewToneMapped)}
              data-scene-merge-color-state={handoffSummary.sceneMergeColorState}
              data-source-count={handoffSummary.sourceCount}
              data-testid="hdr-editable-handoff-provenance"
              data-warning-codes={handoffSummary.warningCodes.join(',')}
              data-working-color-space={handoffSummary.workingColorSpace}
            >
              {[
                {
                  label: t('modals.hdr.handoffEditableAsset'),
                  value: handoffSummary.editableDerivedAssetId,
                },
                {
                  label: t('modals.hdr.handoffColorSpace'),
                  value: t('modals.hdr.handoffDisplayReferredSrgb'),
                },
                {
                  label: t('modals.hdr.handoffSourceCount'),
                  value: t('modals.hdr.summarySourceCount', { count: handoffSummary.sourceCount }),
                },
                {
                  label: t('modals.hdr.handoffPreviewExportParity'),
                  value: t('modals.hdr.handoffPreviewExportMatched'),
                },
                {
                  label: t('modals.hdr.handoffPreviewExportProof'),
                  value: handoffSummary.previewExportParity.parityProofHash,
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
              <div className="col-span-3 rounded border border-border-color bg-surface px-2 py-1.5">
                <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
                  {t('modals.hdr.handoffColorStates')}
                </UiText>
                <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                  {t('modals.hdr.handoffColorStatesValue')}
                </UiText>
              </div>
              <div className="col-span-3 rounded border border-border-color bg-surface px-2 py-1.5">
                <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
                  {t('modals.hdr.handoffSourceRefs')}
                </UiText>
                <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                  {handoffSummary.sourceRefs.map((source) => source.displayName).join(', ') ||
                    t('modals.hdr.handoffNoSourceRefs')}
                </UiText>
              </div>
              <UiText
                as="p"
                variant={TextVariants.small}
                color={TextColors.secondary}
                className="col-span-3 leading-relaxed"
              >
                {t('modals.hdr.handoffToneMappedNotice')}
              </UiText>
            </section>
          )}
          {visibleDerivedOutputReceipt ? (
            <div
              className="mx-auto mt-4 max-w-2xl text-left"
              data-derived-output-receipt-id={visibleDerivedOutputReceipt.receiptId}
              data-hdr-derived-source-open-path={visibleDerivedOutputReceipt.openInEditorAction.path ?? ''}
              data-hdr-derived-source-state={visibleDerivedOutputReceipt.openInEditorAction.state}
              data-testid="hdr-derived-output-receipt-store-entry"
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
                    : t('modals.hdr.handoffPreviewExportMatched')
                }
                warnings={handoffSummary?.warningCodes ?? []}
              />
            </div>
          ) : null}
        </div>
      );
    }

    if (isProcessing) {
      return (
        <MergeProcessingState
          initialLabel={t('modals.hdr.initializing')}
          loadingImageUrl={loadingImageUrl}
          progressMessage={progressMessage}
          sourcePreviewAlt={t('modals.common.sourcePreviewAlt')}
          speedNotice={t('modals.hdr.speedNotice')}
          title={t('modals.hdr.merging')}
        >
          {lastDryRunCommand && (
            <section
              className="mt-5 grid w-full max-w-md grid-cols-3 gap-2 rounded-md border border-border-color bg-surface p-3 text-xs"
              data-command-type={lastDryRunCommand.commandType}
              data-dry-run={String(lastDryRunCommand.dryRun)}
              data-source-count={lastDryRunCommand.sources}
              data-testid="hdr-dry-run-command-state"
              data-tool-name={lastDryRunCommand.toolName}
            >
              {[
                {
                  label: t('modals.hdr.dryRunCommandTool'),
                  value: lastDryRunCommand.toolName,
                },
                {
                  label: t('modals.hdr.dryRunCommandSources'),
                  value: t('modals.hdr.summarySourceCount', { count: lastDryRunCommand.sources }),
                },
                {
                  label: t('modals.hdr.dryRunCommandMode'),
                  value: t('modals.hdr.dryRunCommandModeValue'),
                },
              ].map((item) => (
                <div className="min-w-0 rounded border border-border-color bg-bg-primary px-2 py-1.5" key={item.label}>
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
          {isDeghostReviewRequired && (
            <div
              className="pointer-events-none absolute inset-0"
              data-motion-risk={reviewDiagnostics.deghost.motionRisk}
              data-review-approved={String(isDeghostReviewApproved)}
              data-testid="hdr-deghost-motion-overlay"
            >
              {[
                'left-[18%] top-[22%] h-[22%] w-[24%]',
                'right-[20%] top-[34%] h-[18%] w-[20%]',
                'left-[42%] bottom-[20%] h-[16%] w-[28%]',
              ].map((className, index) => (
                <div
                  className={`absolute rounded border border-yellow-300/70 bg-yellow-300/15 shadow-[0_0_20px_rgba(253,224,71,0.25)] ${className}`}
                  data-testid="hdr-deghost-motion-region"
                  key={index}
                />
              ))}
            </div>
          )}
          <div className="absolute bottom-6 left-6 right-6">
            <UiText as="div" variant={TextVariants.title} className="mb-3 flex items-center gap-2 text-white">
              <Images className="h-6 w-6 text-accent" />
              <span>{t('modals.hdr.title')}</span>
            </UiText>
            <UiText className="text-white/80 leading-relaxed">
              {imageCount ? t('modals.hdr.descriptionWithCount', { count: imageCount }) : t('modals.hdr.description')}
            </UiText>
          </div>
        </div>
        <div className="min-w-0 overflow-y-auto bg-bg-primary p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <UiText variant={TextVariants.title}>{t('modals.hdr.workflowTitle')}</UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                {t('modals.hdr.workflowStatus')}
              </UiText>
            </div>
            <ComputationalMergeAppServerBadge family="hdr" statusLabel={t('editor.ai.connection.ready')} />
          </div>
          <section
            className="mb-5 grid grid-cols-3 gap-2 rounded-md border border-border-color bg-surface p-3 text-xs"
            data-estimated-preview-memory-mb={estimatedPreviewMemoryMb}
            data-estimated-preview-megapixels={estimatedPreviewMegapixels}
            data-preview-source-count={selectedSourceCount}
            data-testid="hdr-setup-summary"
          >
            {[
              {
                label: t('modals.hdr.summarySources'),
                value: `${t('modals.hdr.summarySourceCount', { count: selectedSourceCount })} - ${
                  isSourceSelectionValid ? t('modals.hdr.summaryReady') : t('modals.hdr.summaryBlocked')
                }`,
              },
              {
                label: t('modals.hdr.summaryToneMappingPreset'),
                value: selectedPresetLabel,
              },
              {
                label: t('modals.hdr.summaryAlignment'),
                value: selectedAlignmentLabel,
              },
              {
                label: t('modals.hdr.summaryDeghosting'),
                value: t(`modals.hdr.deghosting.${settings.deghosting}`),
              },
              {
                label: t('modals.hdr.summaryDeghostConfidenceMap'),
                value: settings.deghostConfidenceMapVisible ? t('modals.hdr.summaryOn') : t('modals.hdr.summaryOff'),
              },
              {
                label: t('modals.hdr.summaryDeghostRegionIntensity'),
                value: t('modals.hdr.deghostRegionIntensityValue', {
                  value: settings.deghostRegionIntensityPercent,
                }),
              },
              {
                label: t('modals.hdr.summaryQuality'),
                value: selectedQualityLabel,
              },
              {
                label: t('modals.hdr.summaryStrategy'),
                value: selectedStrategyLabel,
              },
              {
                label: t('modals.hdr.summaryStartState'),
                value: applyReadinessLabel,
              },
              {
                label: t('modals.hdr.summaryPreviewBudget'),
                value: t('modals.hdr.previewPixels', { value: settings.maxPreviewDimensionPx }),
              },
              {
                label: t('modals.hdr.summaryWorkload'),
                value: t('modals.hdr.previewWorkload', { value: estimatedPreviewMegapixels }),
              },
              {
                label: t('modals.hdr.summaryMemory'),
                value: t('modals.hdr.previewMemory', { value: estimatedPreviewMemoryMb }),
              },
              {
                label: t('modals.hdr.summaryToneMapPreview'),
                value: settings.toneMapPreview ? t('modals.hdr.summaryOn') : t('modals.hdr.summaryOff'),
              },
            ].map((item) => (
              <div
                className="rounded border border-border-color bg-bg-primary px-2 py-1.5"
                data-testid="hdr-setup-summary-chip"
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
            className="mb-5 grid grid-cols-4 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-2"
            data-alignment-mode={settings.alignmentMode}
            data-bracket-accepted={bracketPreflight ? String(bracketPreflight.accepted) : 'manual'}
            data-bracket-block-codes={bracketPreflight?.blockCodes.join(',') ?? ''}
            data-bracket-confidence={bracketPreflight?.detectionConfidence ?? ''}
            data-bracket-method={bracketPreflight?.detectionMethod ?? 'manual_order'}
            data-bracket-span-ev={bracketPreflight?.bracketSpanEv ?? ''}
            data-bracket-validation={settings.bracketValidation}
            data-merge-ready={String(isMergeReady)}
            data-source-count={selectedSourceCount}
            data-warning-codes={bracketPreflight?.warningCodes.join(',') ?? ''}
            data-testid="hdr-readiness-summary"
          >
            <div
              className="rounded border border-border-color bg-bg-primary px-2 py-1.5"
              data-testid="hdr-readiness-sources"
            >
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-tertiary">
                {t('modals.hdr.summarySources')}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                {t('modals.hdr.summarySourceCount', { count: selectedSourceCount })}
              </UiText>
            </div>
            <div
              className="rounded border border-border-color bg-bg-primary px-2 py-1.5"
              data-testid="hdr-readiness-validation"
            >
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-tertiary">
                {t('modals.hdr.bracketValidationLabel')}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                {bracketPreflightStatus}
              </UiText>
            </div>
            <div
              className="rounded border border-border-color bg-bg-primary px-2 py-1.5"
              data-testid="hdr-readiness-alignment"
            >
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-tertiary">
                {t('modals.hdr.summaryAlignment')}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                {selectedAlignmentLabel}
              </UiText>
            </div>
            <div
              className={`rounded border px-2 py-1.5 ${
                isMergeReady ? 'border-accent/50 bg-accent/10' : 'border-red-500/40 bg-red-500/10'
              }`}
              data-testid="hdr-readiness-merge"
            >
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-tertiary">
                {t('modals.hdr.summaryStrategy')}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                {mergeReadinessLabel}
              </UiText>
            </div>
          </section>

          {bracketPreflight && (
            <section
              className="mb-5 rounded-md border border-border-color bg-surface p-3"
              data-testid="hdr-bracket-preflight"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <UiText variant={TextVariants.heading}>{t('modals.hdr.bracketPreflightTitle')}</UiText>
                <UiText
                  as="span"
                  variant={TextVariants.small}
                  className={`rounded px-2 py-0.5 ${
                    bracketPreflight.accepted
                      ? 'bg-accent/15 text-accent'
                      : settings.bracketValidation === 'required'
                        ? 'bg-red-500/15 text-red-300'
                        : 'bg-yellow-500/15 text-yellow-200'
                  }`}
                >
                  {bracketPreflightStatus}
                </UiText>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  {
                    label: t('modals.hdr.bracketPreflightMethod'),
                    value: getBracketDetectionMethodLabel(bracketPreflight.detectionMethod),
                  },
                  {
                    label: t('modals.hdr.bracketPreflightSpan'),
                    value: t('modals.hdr.bracketPreflightSpanValue', {
                      value: bracketPreflight.bracketSpanEv.toFixed(1),
                    }),
                  },
                  {
                    label: t('modals.hdr.bracketPreflightConfidence'),
                    value: t('modals.hdr.bracketPreflightConfidenceValue', {
                      value: Math.round(bracketPreflight.detectionConfidence * 100),
                    }),
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
              </div>
              <div className="mt-3 grid gap-1.5">
                {bracketPreflight.sourceMetadata.map((source) => (
                  <button
                    className="grid grid-cols-[48px_78px_96px_1fr] gap-2 rounded border border-border-color bg-bg-primary px-2 py-1.5 text-xs"
                    data-bracket-selected={String(selectedSourceIndexes.has(source.sourceIndex))}
                    data-bracket-role={source.resolvedBracketRole}
                    data-exposure-ev={source.resolvedExposureEv}
                    data-exposure-weight-multiplier={getSourceWeightMultiplier(source)}
                    data-source-index={source.sourceIndex}
                    data-testid="hdr-bracket-source-row"
                    key={`${source.sourceIndex}-${source.imagePath}`}
                    onClick={() => {
                      toggleSourceSelection(source.sourceIndex);
                    }}
                    type="button"
                  >
                    <span className="text-text-tertiary">#{source.sourceIndex + 1}</span>
                    <span className="text-text-primary">
                      {t('modals.hdr.bracketPreflightSourceEv', { value: source.resolvedExposureEv.toFixed(1) })}
                    </span>
                    <span
                      className="rounded bg-surface px-1.5 py-0.5 text-center text-text-primary"
                      data-testid="hdr-bracket-source-role"
                    >
                      {getBracketRoleLabel(source.resolvedBracketRole)}
                    </span>
                    <span className="truncate text-text-secondary">{source.imagePath.split('/').pop()}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2" data-testid="hdr-exposure-weighting-mode">
                {weightingOptions.map((option) => (
                  <button
                    className={`h-9 rounded-md border text-xs transition-colors ${
                      settings.exposureWeightingMode === option.value
                        ? 'border-accent bg-accent/15 text-text-primary'
                        : 'border-border-color bg-bg-primary text-text-secondary hover:bg-card-active'
                    }`}
                    data-exposure-weighting-mode={option.value}
                    key={option.value}
                    onClick={() => {
                      setManualSetting({ exposureWeightingMode: option.value });
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {(bracketPreflight.warningCodes.length > 0 || bracketPreflight.blockCodes.length > 0) && (
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-3 leading-relaxed">
                  {[...bracketPreflight.blockCodes, ...bracketPreflight.warningCodes].join(', ')}
                </UiText>
              )}
            </section>
          )}

          {!isMergeReady && (
            <div className="mb-5 flex gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <UiText className="leading-relaxed">
                {isSourceCountValid
                  ? t('modals.hdr.bracketPreflightBlockedDetail')
                  : t('modals.hdr.sourceCountBlocked')}
              </UiText>
            </div>
          )}

          <section
            className="mb-5 rounded-md border border-border-color bg-surface p-3"
            data-alignment-confidence-percent={reviewDiagnostics.alignment.confidencePercent}
            data-alignment-mode={reviewDiagnostics.alignment.mode}
            data-clipping-risk={reviewDiagnostics.tone.clippingRisk}
            data-deghost-confidence-map-visible={String(reviewDiagnostics.deghost.confidenceMapVisible)}
            data-deghost-level={reviewDiagnostics.deghost.level}
            data-deghost-region-intensity-percent={reviewDiagnostics.deghost.regionIntensityPercent}
            data-motion-risk={reviewDiagnostics.deghost.motionRisk}
            data-non-claims={reviewDiagnostics.nonClaims.join(',')}
            data-proof-level={reviewDiagnostics.proofLevel}
            data-review-decision={reviewDiagnostics.reviewDecision}
            data-tone-policy={reviewDiagnostics.tone.policy}
            data-warning-codes={reviewDiagnostics.warningCodes.join(',')}
            data-warning-severity={reviewDiagnostics.warningSeverity}
            data-testid="hdr-review-diagnostics-panel"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <UiText variant={TextVariants.heading}>{t('modals.hdr.reviewDiagnosticsTitle')}</UiText>
              <UiText
                as="span"
                variant={TextVariants.small}
                className={`rounded px-2 py-0.5 ${
                  reviewDiagnostics.warningSeverity === 'blocked'
                    ? 'bg-red-500/15 text-red-300'
                    : reviewDiagnostics.warningSeverity === 'review'
                      ? 'bg-yellow-500/15 text-yellow-200'
                      : 'bg-accent/15 text-accent'
                }`}
              >
                {t(`modals.hdr.reviewSeverity.${reviewDiagnostics.warningSeverity}`)}
              </UiText>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                {
                  label: t('modals.hdr.reviewAlignment'),
                  status: reviewDiagnostics.alignment.status,
                  value: t('modals.hdr.reviewAlignmentValue', {
                    confidence: reviewDiagnostics.alignment.confidencePercent,
                    mode: selectedAlignmentLabel,
                  }),
                },
                {
                  label: t('modals.hdr.reviewDeghost'),
                  status: reviewDiagnostics.deghost.status,
                  value: t('modals.hdr.reviewDeghostValue', {
                    level: t(`modals.hdr.deghosting.${reviewDiagnostics.deghost.level}`),
                    risk: t(`modals.hdr.reviewRisk.${reviewDiagnostics.deghost.motionRisk}`),
                  }),
                },
                {
                  label: t('modals.hdr.reviewTone'),
                  status: reviewDiagnostics.tone.status,
                  value: t('modals.hdr.reviewToneValue', {
                    risk: t(`modals.hdr.reviewRisk.${reviewDiagnostics.tone.clippingRisk}`),
                  }),
                },
              ].map((item) => (
                <div
                  className="rounded border border-border-color bg-bg-primary px-2 py-1.5"
                  data-review-status={item.status}
                  data-testid="hdr-review-diagnostic-row"
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
            </div>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-3 block leading-relaxed">
              {t('modals.hdr.reviewDiagnosticsLimit')}
            </UiText>
          </section>

          {isDeghostReviewRequired && (
            <section
              className={`mb-5 rounded-md border p-3 ${
                isDeghostReviewApproved ? 'border-accent/50 bg-accent/10' : 'border-yellow-500/45 bg-yellow-500/10'
              }`}
              data-deghost-level={settings.deghosting}
              data-deghost-confidence-map-visible={String(settings.deghostConfidenceMapVisible)}
              data-deghost-region-intensity-percent={settings.deghostRegionIntensityPercent}
              data-motion-risk={reviewDiagnostics.deghost.motionRisk}
              data-review-approved={String(isDeghostReviewApproved)}
              data-review-required={String(isDeghostReviewRequired)}
              data-testid="hdr-deghost-review-gate"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <UiText variant={TextVariants.heading}>{t('modals.hdr.deghostReviewTitle')}</UiText>
                <UiText
                  as="span"
                  variant={TextVariants.small}
                  className={`rounded px-2 py-0.5 ${
                    isDeghostReviewApproved ? 'bg-accent/15 text-accent' : 'bg-yellow-500/15 text-yellow-200'
                  }`}
                >
                  {isDeghostReviewApproved
                    ? t('modals.hdr.deghostReviewApproved')
                    : t('modals.hdr.deghostReviewRequired')}
                </UiText>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  {
                    label: t('modals.hdr.deghostReviewMask'),
                    value: settings.deghostConfidenceMapVisible
                      ? t('modals.hdr.deghostReviewConfidenceMapValue')
                      : t('modals.hdr.deghostReviewMaskValue'),
                  },
                  {
                    label: t('modals.hdr.deghostReviewMotion'),
                    value: t(`modals.hdr.reviewRisk.${reviewDiagnostics.deghost.motionRisk}`),
                  },
                  {
                    label: t('modals.hdr.deghostReviewReference'),
                    value:
                      bracketPreflight === null
                        ? t('modals.hdr.bracketPreflightManual')
                        : t('modals.hdr.deghostReviewReferenceValue', {
                            value: bracketPreflight.referenceSourceIndex + 1,
                          }),
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
              </div>
              <button
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                  isDeghostReviewApproved
                    ? 'border-accent bg-accent/15 text-text-primary'
                    : 'border-border-color bg-bg-primary text-text-secondary hover:bg-card-active'
                }`}
                data-testid="hdr-deghost-review-approve"
                onClick={() => {
                  setIsDeghostReviewApproved((approved) => !approved);
                }}
                type="button"
              >
                <ShieldCheck className="h-4 w-4" />
                {isDeghostReviewApproved
                  ? t('modals.hdr.deghostReviewApprovedAction')
                  : t('modals.hdr.deghostReviewApproveAction')}
              </button>
            </section>
          )}

          <section
            className="mb-5 rounded-md border border-border-color bg-surface p-3"
            data-deghosting={settings.deghosting}
            data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
            data-merge-strategy={settings.mergeStrategy}
            data-quality-preference={settings.qualityPreference}
            data-testid="hdr-tone-mapping-presets"
            data-tone-map-preview={String(settings.toneMapPreview)}
            data-tone-mapping-preset={settings.toneMappingPreset}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <UiText variant={TextVariants.heading}>{t('modals.hdr.toneMappingPresetLabel')}</UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
                {selectedPresetLabel}
              </UiText>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {HDR_TONE_MAPPING_PRESETS.map((preset) => (
                <button
                  className={`min-h-10 rounded-md border px-3 py-2 text-sm transition-colors ${
                    settings.toneMappingPreset === preset.id
                      ? 'border-accent bg-accent/15 text-text-primary'
                      : 'border-border-color bg-bg-primary text-text-secondary hover:bg-card-active'
                  }`}
                  data-testid={`hdr-tone-mapping-preset-${preset.id}`}
                  key={preset.id}
                  onClick={() => {
                    selectToneMappingPreset(preset.id);
                  }}
                  type="button"
                >
                  {getToneMappingPresetLabel(preset.id)}
                </button>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-4">
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.hdr.alignmentLabel')}
              </UiText>
              <Dropdown
                options={alignmentOptions}
                value={settings.alignmentMode}
                onChange={(alignmentMode) => {
                  setManualSetting({ alignmentMode });
                }}
              />
            </div>
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.hdr.qualityLabel')}
              </UiText>
              <Dropdown
                options={qualityOptions}
                value={settings.qualityPreference}
                onChange={(qualityPreference) => {
                  setManualSetting({ qualityPreference });
                }}
              />
            </div>
          </section>

          <section className="mt-5">
            <UiText variant={TextVariants.heading} className="mb-3">
              {t('modals.hdr.deghostingLabel')}
            </UiText>
            <div className="grid grid-cols-4 gap-2">
              {(['off', 'low', 'medium', 'high'] as const).map((deghosting: HdrMergeDeghosting) => (
                <button
                  key={deghosting}
                  className={`h-10 rounded-md border text-sm transition-colors ${
                    settings.deghosting === deghosting
                      ? 'border-accent bg-accent/15 text-text-primary'
                      : 'border-border-color bg-surface text-text-secondary hover:bg-card-active'
                  }`}
                  onClick={() => {
                    setIsDeghostReviewApproved(false);
                    setManualSetting({ deghosting });
                  }}
                  type="button"
                >
                  {t(`modals.hdr.deghosting.${deghosting}`)}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className={`h-10 rounded-md border text-sm transition-colors ${
                  settings.deghostConfidenceMapVisible
                    ? 'border-accent bg-accent/15 text-text-primary'
                    : 'border-border-color bg-surface text-text-secondary hover:bg-card-active'
                }`}
                data-testid="hdr-deghost-confidence-map-toggle"
                onClick={() => {
                  setIsDeghostReviewApproved(false);
                  setManualSetting({ deghostConfidenceMapVisible: !settings.deghostConfidenceMapVisible });
                }}
                type="button"
              >
                {t('modals.hdr.deghostConfidenceMapToggle')}
              </button>
              <div
                className="grid grid-cols-3 gap-1"
                data-deghost-region-intensity-percent={settings.deghostRegionIntensityPercent}
                data-testid="hdr-deghost-region-intensity"
              >
                {[45, 65, 85].map((deghostRegionIntensityPercent) => (
                  <button
                    key={deghostRegionIntensityPercent}
                    className={`h-10 rounded-md border text-sm transition-colors ${
                      settings.deghostRegionIntensityPercent === deghostRegionIntensityPercent
                        ? 'border-accent bg-accent/15 text-text-primary'
                        : 'border-border-color bg-surface text-text-secondary hover:bg-card-active'
                    }`}
                    onClick={() => {
                      setIsDeghostReviewApproved(false);
                      setManualSetting({ deghostRegionIntensityPercent });
                    }}
                    type="button"
                  >
                    {t('modals.hdr.deghostRegionIntensityValue', {
                      value: deghostRegionIntensityPercent,
                    })}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.hdr.strategyLabel')}
              </UiText>
              <Dropdown
                options={strategyOptions}
                value={settings.mergeStrategy}
                onChange={(mergeStrategy) => {
                  setManualSetting({ mergeStrategy });
                }}
              />
            </div>
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.hdr.bracketValidationLabel')}
              </UiText>
              <button
                className={`h-10 w-full rounded-md border text-sm transition-colors ${
                  settings.bracketValidation === 'required'
                    ? 'border-accent bg-accent/15 text-text-primary'
                    : 'border-border-color bg-surface text-text-secondary hover:bg-card-active'
                }`}
                onClick={() => {
                  setManualSetting({
                    bracketValidation: settings.bracketValidation === 'required' ? 'warn' : 'required',
                  });
                }}
                type="button"
              >
                {bracketValidationLabel}
              </button>
            </div>
          </section>

          <section className="mt-5">
            <UiText variant={TextVariants.heading} className="mb-3">
              {t('modals.hdr.previewBudgetLabel')}
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
                    setManualSetting({ maxPreviewDimensionPx });
                  }}
                  type="button"
                >
                  {t('modals.hdr.previewPixels', { value: maxPreviewDimensionPx })}
                </button>
              ))}
            </div>
          </section>

          <label className="mt-5 flex items-center justify-between rounded-md border border-border-color bg-surface px-4 py-3">
            <UiText variant={TextVariants.label}>{t('modals.hdr.toneMapPreview')}</UiText>
            <input
              checked={settings.toneMapPreview}
              className="h-4 w-4 accent-accent"
              onChange={(event) => {
                setManualSetting({ toneMapPreview: event.target.checked });
              }}
              type="checkbox"
            />
          </label>

          <div className="mt-5 flex items-start gap-3 rounded-md border border-border-color bg-surface px-4 py-3">
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="leading-relaxed">
              {t('modals.hdr.uiOnlyNotice')}
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
        isSourceCountValid={isApplyReady}
        labels={{
          cancel: t('modals.hdr.cancel'),
          close: t('modals.hdr.close'),
          openInEditor: t('modals.hdr.openInEditor'),
          retry: t('modals.hdr.retry'),
          save: t('modals.hdr.save'),
          start: t('modals.hdr.start'),
        }}
        onClose={handleClose}
        onOpen={handleOpen}
        onRun={handleRun}
        onSave={() => {
          void handleSave();
        }}
        savedPath={finalImageBase64 === null ? null : savedPath}
        StartIcon={Images}
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
