import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle,
  Clock3,
  Gauge,
  Images,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import {
  type HdrAlignmentMode,
  type HdrDeghostingMode,
  type HdrQualityPreference,
  type HdrUiSettings,
} from '../../schemas/hdrUiSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import UiText from '../ui/Text';

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
  onMerge: () => void;
  onSettingsChange: (settings: HdrUiSettings) => void;
  progressMessage: string | null;
  settings: HdrUiSettings;
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
  onMerge,
  onSettingsChange,
  progressMessage,
  settings,
}: HdrModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const mouseDownTarget = useRef<EventTarget | null>(null);
  const isSourceCountValid = (imageCount ?? 0) >= 2;

  const alignmentOptions: Array<OptionItem<HdrAlignmentMode>> = [
    { label: t('modals.hdr.alignment.auto'), value: 'auto' },
    { label: t('modals.hdr.alignment.translation'), value: 'translation' },
    { label: t('modals.hdr.alignment.none'), value: 'none' },
  ];

  const deghostingOptions: Array<OptionItem<HdrDeghostingMode>> = [
    { label: t('modals.hdr.deghosting.off'), value: 'off' },
    { label: t('modals.hdr.deghosting.low'), value: 'low' },
    { label: t('modals.hdr.deghosting.medium'), value: 'medium' },
    { label: t('modals.hdr.deghosting.high'), value: 'high' },
  ];

  const qualityOptions: Array<OptionItem<HdrQualityPreference>> = [
    { label: t('modals.hdr.quality.preview'), value: 'preview' },
    { label: t('modals.hdr.quality.balanced'), value: 'balanced' },
    { label: t('modals.hdr.quality.best'), value: 'best' },
  ];

  const setSetting = useCallback(
    (patch: Partial<HdrUiSettings>) => {
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
            {t('modals.hdr.failed')}
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
              alt={t('modals.hdr.mergedAlt')}
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
                <span>{t('modals.hdr.savedSuccess')}</span>
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
                {t('modals.hdr.merging')}
              </UiText>
              <UiText className="text-center font-mono h-6 flex justify-center items-center">
                {progressMessage || t('modals.hdr.initializing')}
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
                {t('modals.hdr.speedNotice')}
              </UiText>
            </motion.div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-[520px] overflow-hidden rounded-lg border border-surface">
        <div className="relative w-[42%] min-w-[300px] overflow-hidden bg-[#0a0a0a] border-r border-surface">
          {loadingImageUrl ? (
            <img
              src={loadingImageUrl}
              alt={t('modals.common.sourcePreviewAlt')}
              className="h-full w-full object-cover opacity-75"
            />
          ) : (
            <div className="h-full w-full bg-bg-primary" />
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-black/35" />
          <div className="absolute left-6 right-6 bottom-6">
            <UiText as="div" variant={TextVariants.title} className="flex items-center gap-2 mb-3 text-white">
              <Images className="w-6 h-6 text-accent" />
              <span>{t('modals.hdr.title')}</span>
            </UiText>
            <UiText className="text-white/80 leading-relaxed">
              {imageCount ? t('modals.hdr.descriptionWithCount', { count: imageCount }) : t('modals.hdr.description')}
            </UiText>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-6 py-5 border-b border-surface/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <UiText variant={TextVariants.title}>{t('modals.hdr.workflowTitle')}</UiText>
                <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                  {t('modals.hdr.workflowStatus')}
                </UiText>
              </div>
              <div className="shrink-0 flex items-center gap-2 rounded-md border border-border-color px-3 py-2 bg-bg-primary">
                <Clock3 className="w-4 h-4 text-text-secondary" />
                <UiText variant={TextVariants.small}>{t('modals.hdr.apiPending')}</UiText>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
            {!isSourceCountValid && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 flex gap-3">
                <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
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

            <section>
              <UiText variant={TextVariants.heading} className="mb-3">
                {t('modals.hdr.mergeStrategyLabel')}
              </UiText>
              <div className="grid grid-cols-2 gap-2">
                {(['scene_linear_radiance', 'exposure_fusion_preview'] as const).map((mergeStrategy) => (
                  <button
                    key={mergeStrategy}
                    className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                      settings.mergeStrategy === mergeStrategy
                        ? 'border-accent bg-accent/15'
                        : 'border-border-color bg-bg-primary hover:bg-card-active'
                    }`}
                    onClick={() => {
                      setSetting({ mergeStrategy });
                    }}
                    type="button"
                  >
                    <UiText as="span" variant={TextVariants.label}>
                      {t(`modals.hdr.mergeStrategy.${mergeStrategy}.label`)}
                    </UiText>
                    <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                      {t(`modals.hdr.mergeStrategy.${mergeStrategy}.status`)}
                    </UiText>
                  </button>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-2 gap-4">
              <div>
                <UiText variant={TextVariants.heading} className="mb-2">
                  {t('modals.hdr.deghostingLabel')}
                </UiText>
                <Dropdown
                  options={deghostingOptions}
                  value={settings.deghostingMode}
                  onChange={(deghostingMode) => {
                    setSetting({ deghostingMode });
                  }}
                />
              </div>
              <div>
                <UiText variant={TextVariants.heading} className="mb-2">
                  {t('modals.hdr.previewBudgetLabel')}
                </UiText>
                <div className="grid grid-cols-3 gap-2">
                  {[2400, 4096, 8192].map((maxPreviewDimensionPx) => (
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
                      {t('modals.hdr.previewBudgetValue', { value: maxPreviewDimensionPx })}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-md border border-border-color bg-bg-primary p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-5 h-5 text-accent" />
                <UiText variant={TextVariants.heading}>{t('modals.hdr.preflightTitle')}</UiText>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <StatusLine label={t('modals.hdr.preflight.sources')} value={String(imageCount ?? 0)} />
                <StatusLine
                  label={t('modals.hdr.preflight.strategy')}
                  value={t(`modals.hdr.mergeStrategy.${settings.mergeStrategy}.label`)}
                />
                <StatusLine
                  label={t('modals.hdr.preflight.deghosting')}
                  value={t(`modals.hdr.deghosting.${settings.deghostingMode}`)}
                />
                <StatusLine label={t('modals.hdr.preflight.output')} value={t('modals.hdr.preflight.editable')} />
              </div>
            </motion.section>

            <div className="rounded-md border border-border-color bg-bg-primary px-4 py-3 flex gap-3">
              <Gauge className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
              <UiText className="leading-relaxed">{t('modals.hdr.planDependency')}</UiText>
            </div>

            {settings.mergeStrategy === 'exposure_fusion_preview' && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                <UiText className="leading-relaxed">{t('modals.hdr.exposureFusionNotice')}</UiText>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderButtons = () => {
    if (error) {
      return (
        <Button onClick={handleClose} className="w-full">
          {t('modals.hdr.close')}
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
            {t('modals.hdr.close')}
          </button>
          <Button onClick={handleOpen}>{t('modals.hdr.openInEditor')}</Button>
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
          {finalImageBase64 ? t('modals.hdr.close') : t('modals.hdr.cancel')}
        </button>

        <Button onClick={onMerge} disabled={isProcessing} variant={finalImageBase64 ? 'secondary' : 'primary'}>
          {isProcessing ? (
            <Loader2 className="animate-spin mr-2" size={16} />
          ) : finalImageBase64 ? (
            <RefreshCw className="mr-2" size={16} />
          ) : (
            <Images className="mr-2" size={16} />
          )}
          {finalImageBase64 ? t('modals.hdr.retry') : t('modals.hdr.start')}
        </Button>

        {finalImageBase64 && (
          <Button
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving || isProcessing}
          >
            {isSaving ? <Loader2 className="animate-spin mr-2" size={16} /> : <Save className="mr-2" size={16} />}
            {t('modals.hdr.save')}
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
        aria-label={t('modals.hdr.title')}
        aria-modal="true"
        role="dialog"
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

interface StatusLineProps {
  label: string;
  value: string;
}

function StatusLine({ label, value }: StatusLineProps) {
  return (
    <div className="min-w-0">
      <UiText as="div" variant={TextVariants.small} color={TextColors.secondary}>
        {label}
      </UiText>
      <UiText as="div" variant={TextVariants.label} className="truncate">
        {value}
      </UiText>
    </div>
  );
}
