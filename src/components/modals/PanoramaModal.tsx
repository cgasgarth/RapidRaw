import { Layers, ShieldCheck, XCircle } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import ComputationalMergeReviewPanel from './ComputationalMergeReviewPanel';
import { MergeErrorState, MergeFooterActions, MergeProcessingState, MergeResultPreview } from './MergeStatusViews';
import { useModalTransition } from '../../hooks/useModalTransition';
import { TextColors, TextVariants } from '../../types/typography';
import ComputationalMergeAppServerBadge from '../ui/ComputationalMergeAppServerBadge';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import UiText from '../ui/Text';

import type {
  PanoramaUiBlendMode,
  PanoramaUiBoundaryMode,
  PanoramaUiExposureMode,
  PanoramaUiProjection,
  PanoramaUiQualityPreference,
  PanoramaUiSettings,
} from '../../schemas/panoramaUiSchemas';

interface PanoramaModalProps {
  error: string | null;
  finalImageBase64: string | null;
  imageCount?: number;
  isOpen: boolean;
  isProcessing: boolean;
  loadingImageUrl?: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onSave: () => Promise<string>;
  onSettingsChange: (settings: PanoramaUiSettings) => void;
  onStitch: () => void;
  progressMessage: string | null;
  settings: PanoramaUiSettings;
}

export default function PanoramaModal({
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
  onStitch,
  progressMessage,
  settings,
}: PanoramaModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const mouseDownTarget = useRef<EventTarget | null>(null);
  const isSourceCountValid = (imageCount ?? 0) >= 2;

  const projectionOptions: Array<OptionItem<PanoramaUiProjection>> = [
    { label: t('modals.panorama.projection.cylindrical'), value: 'cylindrical' },
    { label: t('modals.panorama.projection.spherical'), value: 'spherical' },
    { label: t('modals.panorama.projection.rectilinear'), value: 'rectilinear' },
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
  const exposureOptions: Array<OptionItem<PanoramaUiExposureMode>> = [
    { label: t('modals.panorama.exposure.gainCompensation'), value: 'gain_compensation' },
    { label: t('modals.panorama.exposure.none'), value: 'none' },
  ];
  const selectedBoundaryLabel = boundaryOptions.find((option) => option.value === settings.boundaryMode)?.label ?? '';
  const selectedExposureLabel = exposureOptions.find((option) => option.value === settings.exposureMode)?.label ?? '';
  const selectedProjectionLabel = projectionOptions.find((option) => option.value === settings.projection)?.label ?? '';
  const selectedQualityLabel =
    qualityOptions.find((option) => option.value === settings.qualityPreference)?.label ?? '';
  const sourceReadinessLabel = `${t('modals.panorama.summarySourceCount', { count: imageCount ?? 0 })} - ${
    isSourceCountValid ? t('modals.panorama.summaryReady') : t('modals.panorama.summaryBlocked')
  }`;

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
      return <MergeErrorState error={error} title={t('modals.panorama.failed')} />;
    }

    if (finalImageBase64 && !isProcessing) {
      return (
        <MergeResultPreview
          alt={t('modals.panorama.stitchedAlt')}
          imageBase64={finalImageBase64}
          savedPath={savedPath}
          savedSuccessLabel={t('modals.panorama.savedSuccess')}
        />
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

          {!isSourceCountValid && (
            <div className="mb-5 flex gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <UiText className="leading-relaxed">{t('modals.panorama.sourceCountBlocked')}</UiText>
            </div>
          )}

          <section className="grid grid-cols-2 gap-4">
            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('modals.panorama.projectionLabel')}
              </UiText>
              <Dropdown
                options={projectionOptions}
                value={settings.projection}
                onChange={(projection) => {
                  setSetting({ projection });
                }}
              />
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
              <Dropdown
                options={boundaryOptions}
                value={settings.boundaryMode}
                onChange={(boundaryMode) => {
                  setSetting({ boundaryMode });
                }}
              />
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
                  value: t('modals.panorama.review.privateRawPending'),
                },
                {
                  label: t('modals.panorama.review.projectionCrop'),
                  status: 'pending',
                  value: t('modals.panorama.review.uiE2ePending'),
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
                      value: t('modals.panorama.review.privateRawPending'),
                    },
                    {
                      label: t('modals.panorama.review.projectionCrop'),
                      value: t('modals.panorama.review.uiE2ePending'),
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
        isSourceCountValid={isSourceCountValid}
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
        onRun={onStitch}
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
