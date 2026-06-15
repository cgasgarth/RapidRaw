import { motion } from 'framer-motion';
import { CheckCircle, Clock3, Layers, Loader2, RefreshCw, Save, ShieldCheck, XCircle } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import {
  type PanoramaUiBlendMode,
  type PanoramaUiBoundaryMode,
  type PanoramaUiExposureMode,
  type PanoramaUiProjection,
  type PanoramaUiQualityPreference,
  type PanoramaUiSettings,
} from '../../schemas/panoramaUiSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import UiText from '../ui/Text';

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
      return (
        <div className="flex flex-col items-center justify-center py-10 h-[460px]">
          <div className="flex items-center justify-center mb-6">
            <XCircle className="w-12 h-12 text-red-500" />
          </div>
          <UiText variant={TextVariants.title} className="mb-2 text-center">
            {t('modals.panorama.failed')}
          </UiText>
          <UiText className="text-center p-4 rounded-lg bg-bg-primary max-w-md mt-2 leading-relaxed">{error}</UiText>
        </div>
      );
    }

    if (finalImageBase64 && !isProcessing) {
      return (
        <div className="w-full">
          <div className="w-full max-h-[500px] bg-[#111] rounded-lg overflow-hidden border border-surface flex items-center justify-center">
            <img
              src={finalImageBase64}
              alt={t('modals.panorama.stitchedAlt')}
              className="w-full h-full object-contain max-h-[500px]"
            />
          </div>
          {savedPath && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <UiText
                as="div"
                variant={TextVariants.heading}
                color={TextColors.success}
                className="flex items-center justify-center gap-2 mt-4"
              >
                <CheckCircle className="w-5 h-5" />
                <span>{t('modals.panorama.savedSuccess')}</span>
              </UiText>
            </motion.div>
          )}
        </div>
      );
    }

    if (isProcessing) {
      return (
        <div className="flex h-[460px] overflow-hidden rounded-lg border border-surface">
          <div className="w-2/5 relative overflow-hidden shrink-0 bg-[#0a0a0a] flex items-center justify-center">
            {loadingImageUrl ? (
              <img
                src={loadingImageUrl}
                alt={t('modals.common.sourcePreviewAlt')}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-surface/50" />
            )}
          </div>
          <div className="flex-1 flex flex-col items-center justify-center px-12 bg-bg-primary">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="flex flex-col items-center w-full"
            >
              <UiText variant={TextVariants.title} className="mb-2 text-center">
                {t('modals.panorama.stitchingProgress')}
              </UiText>
              <UiText className="text-center font-mono h-6 flex justify-center items-center">
                {progressMessage || t('modals.panorama.initializing')}
              </UiText>

              <div className="mt-8 w-64 relative">
                <div className="h-1 bg-surface rounded-full overflow-hidden relative w-full shadow-xs">
                  <motion.div
                    className="absolute inset-y-0 w-[80%] bg-linear-to-r from-transparent via-accent to-transparent mix-blend-screen"
                    style={{ filter: 'blur(3px)' }}
                    animate={{ x: ['-150%', '150%'] }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: [0.4, 0, 0.2, 1] }}
                  />
                  <motion.div
                    className="absolute inset-y-0 w-[40%] bg-linear-to-r from-transparent via-white/90 to-transparent"
                    style={{ filter: 'blur(1px)' }}
                    animate={{ x: ['-250%', '250%'] }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: [0.4, 0, 0.2, 1] }}
                  />
                </div>
              </div>

              <UiText variant={TextVariants.small} className="mt-6 text-center max-w-xs opacity-60">
                {t('modals.panorama.speedNotice')}
              </UiText>
            </motion.div>
          </div>
        </div>
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
            <div className="flex shrink-0 items-center gap-2 rounded-md border border-border-color bg-surface px-3 py-2">
              <Clock3 className="h-4 w-4 text-text-secondary" />
              <UiText variant={TextVariants.small}>{t('modals.panorama.apiPending')}</UiText>
            </div>
          </div>

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
    if (error) {
      return (
        <Button onClick={handleClose} className="w-full">
          {t('modals.panorama.close')}
        </Button>
      );
    }

    if (savedPath) {
      return (
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors"
          >
            {t('modals.panorama.close')}
          </button>
          <Button onClick={handleOpen}>{t('modals.panorama.openInEditor')}</Button>
        </>
      );
    }

    const disabled = isProcessing || isSaving;

    return (
      <div className={`w-full flex items-center justify-end gap-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <button
          onClick={handleClose}
          className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
        >
          {finalImageBase64 ? t('modals.panorama.close') : t('modals.panorama.cancel')}
        </button>

        <Button
          onClick={onStitch}
          disabled={isProcessing || (!finalImageBase64 && !isSourceCountValid)}
          variant={finalImageBase64 ? 'secondary' : 'primary'}
        >
          {isProcessing ? (
            <Loader2 className="animate-spin mr-2" size={16} />
          ) : finalImageBase64 ? (
            <RefreshCw className="mr-2" size={16} />
          ) : (
            <Layers className="mr-2" size={16} />
          )}
          {finalImageBase64 ? t('modals.panorama.retry') : t('modals.panorama.start')}
        </Button>

        {finalImageBase64 && (
          <Button
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving || isProcessing}
          >
            {isSaving ? <Loader2 className="animate-spin mr-2" size={16} /> : <Save className="mr-2" size={16} />}
            {t('modals.panorama.save')}
          </Button>
        )}
      </div>
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
