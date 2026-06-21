import { CheckCircle, Images, XCircle } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { MergeErrorState, MergeFooterActions, MergeProcessingState, MergeResultPreview } from './MergeStatusViews';
import { useModalTransition } from '../../hooks/useModalTransition';
import { TextColors, TextVariants } from '../../types/typography';
import { buildHdrEditableHandoffSummary } from '../../utils/hdrEditableHandoff';
import ComputationalMergeAppServerBadge from '../ui/ComputationalMergeAppServerBadge';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import UiText from '../ui/Text';

import type {
  HdrMergeAlignmentMode,
  HdrMergeDeghosting,
  HdrMergeQualityPreference,
  HdrMergeStrategy,
  HdrMergeUiSettings,
} from '../../schemas/hdrMergeUiSchemas';

interface HdrModalProps {
  error: string | null;
  finalImageBase64: string | null;
  imageCount?: number;
  isOpen: boolean;
  isProcessing: boolean;
  loadingImageUrl?: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onSave: () => Promise<string>;
  onSettingsChange: (settings: HdrMergeUiSettings) => void;
  onMerge: () => void;
  progressMessage: string | null;
  settings: HdrMergeUiSettings;
  sourcePaths?: string[];
}

export default function HdrModal({
  error,
  finalImageBase64,
  imageCount,
  isOpen,
  isProcessing,
  loadingImageUrl,
  onClose,
  onOpenFile,
  onSave,
  onSettingsChange,
  onMerge,
  progressMessage,
  settings,
  sourcePaths = [],
}: HdrModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const mouseDownTarget = useRef<EventTarget | null>(null);
  const isSourceCountValid = (imageCount ?? 0) >= 2;

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
  const selectedAlignmentLabel =
    alignmentOptions.find((option) => option.value === settings.alignmentMode)?.label ?? '';
  const selectedQualityLabel =
    qualityOptions.find((option) => option.value === settings.qualityPreference)?.label ?? '';
  const selectedStrategyLabel = strategyOptions.find((option) => option.value === settings.mergeStrategy)?.label ?? '';
  const estimatedPreviewMegapixels = Math.round(((imageCount ?? 0) * settings.maxPreviewDimensionPx ** 2) / 1_000_000);
  const estimatedPreviewMemoryMb = Math.max(
    0,
    Math.round(((imageCount ?? 0) * settings.maxPreviewDimensionPx ** 2 * 4) / 1_000_000),
  );

  const setSetting = useCallback(
    (patch: Partial<HdrMergeUiSettings>) => {
      onSettingsChange({ ...settings, ...patch });
    },
    [onSettingsChange, settings],
  );
  const bracketValidationLabel =
    settings.bracketValidation === 'required'
      ? t('modals.hdr.bracketValidation.required')
      : settings.bracketValidation === 'warn'
        ? t('modals.hdr.bracketValidation.warn')
        : t('modals.hdr.bracketValidation.disabled');
  const mergeReadinessLabel = isSourceCountValid ? t('modals.hdr.summaryReady') : t('modals.hdr.summaryBlocked');
  const handoffSummary =
    savedPath !== null ? buildHdrEditableHandoffSummary({ outputPath: savedPath, settings, sourcePaths }) : null;

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setSavedPath(null);
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
      setSavedPath(path);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpen = () => {
    if (savedPath) {
      onOpenFile(savedPath);
      handleClose();
    }
  };

  const renderContent = () => {
    if (error) {
      return <MergeErrorState error={error} title={t('modals.hdr.failed')} />;
    }

    if (finalImageBase64 && !isProcessing) {
      return (
        <MergeResultPreview
          alt={t('modals.hdr.mergedAlt')}
          imageBase64={finalImageBase64}
          savedPath={savedPath}
          savedSuccessLabel={t('modals.hdr.savedSuccess')}
        >
          {handoffSummary && (
            <section
              className="mx-auto mt-4 grid max-w-2xl grid-cols-3 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-left"
              data-capability-level={handoffSummary.capabilityLevel}
              data-editable-derived-asset-id={handoffSummary.editableDerivedAssetId}
              data-merge-strategy={handoffSummary.mergeStrategy}
              data-output-color-space={handoffSummary.outputColorSpace}
              data-output-encoding={handoffSummary.outputEncoding}
              data-preview-tone-mapped={String(handoffSummary.previewToneMapped)}
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
        </MergeResultPreview>
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
        />
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
            data-preview-source-count={imageCount ?? 0}
            data-testid="hdr-setup-summary"
          >
            {[
              {
                label: t('modals.hdr.summarySources'),
                value: `${t('modals.hdr.summarySourceCount', { count: imageCount ?? 0 })} - ${
                  isSourceCountValid ? t('modals.hdr.summaryReady') : t('modals.hdr.summaryBlocked')
                }`,
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
                label: t('modals.hdr.summaryQuality'),
                value: selectedQualityLabel,
              },
              {
                label: t('modals.hdr.summaryStrategy'),
                value: selectedStrategyLabel,
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
            data-bracket-validation={settings.bracketValidation}
            data-merge-ready={String(isSourceCountValid)}
            data-source-count={imageCount ?? 0}
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
                {t('modals.hdr.summarySourceCount', { count: imageCount ?? 0 })}
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
                {bracketValidationLabel}
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
                isSourceCountValid ? 'border-accent/50 bg-accent/10' : 'border-red-500/40 bg-red-500/10'
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

          {!isSourceCountValid && (
            <div className="mb-5 flex gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <UiText className="leading-relaxed">{t('modals.hdr.sourceCountBlocked')}</UiText>
            </div>
          )}

          <section className="grid grid-cols-2 gap-4">
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.hdr.alignmentLabel')}
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
                {t('modals.hdr.qualityLabel')}
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
                    setSetting({ deghosting });
                  }}
                  type="button"
                >
                  {t(`modals.hdr.deghosting.${deghosting}`)}
                </button>
              ))}
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
                  setSetting({ mergeStrategy });
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
                  setSetting({ bracketValidation: settings.bracketValidation === 'required' ? 'warn' : 'required' });
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
                    setSetting({ maxPreviewDimensionPx });
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
                setSetting({ toneMapPreview: event.target.checked });
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
        isSourceCountValid={isSourceCountValid}
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
        onRun={onMerge}
        onSave={() => {
          void handleSave();
        }}
        savedPath={savedPath}
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
        className={`bg-surface rounded-xl shadow-2xl p-6 w-full max-w-4xl transform transition-all duration-300 ease-out ${
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
        <div className="flex flex-col">
          {renderContent()}
          <div className={`mt-4 flex justify-end gap-3 ${savedPath ? '' : 'pt-4 border-t border-surface/50'}`}>
            {renderButtons()}
          </div>
        </div>
      </div>
    </div>
  );
}
