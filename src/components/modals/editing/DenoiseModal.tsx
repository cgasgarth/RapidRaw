import { listen } from '@tauri-apps/api/event';
import { motion } from 'framer-motion';
import { CheckCircle, Grip, Loader2, Move, RefreshCw, Save, XCircle, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { usePreviewViewport } from '../../../hooks/viewport/usePreviewViewport';
import { parsePathProgressPayload } from '../../../schemas/tauriEventSchemas';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { getDisplayFileName } from '../../../utils/displayFilePath';
import Button from '../../ui/Button';
import Dropdown from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import UiText from '../../ui/Text';

interface DenoiseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDenoise: (intensity: number, method: 'ai' | 'bm3d') => void;
  onBatchDenoise: (intensity: number, method: 'ai' | 'bm3d', paths: string[]) => Promise<string[]>;
  onSave: () => Promise<string>;
  onOpenFile: (path: string) => void;
  error: string | null;
  previewBase64: string | null;
  originalBase64: string | null;
  isProcessing: boolean;
  progressMessage: string | null;
  aiModelDownloadStatus: string | null;
  isRaw: boolean;
  loadingImageUrl?: string | null;
  targetPaths: string[];
}

const ImageCompare = ({ original, denoised }: { original: string; denoised: string }) => {
  const { t } = useTranslation();
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isResizingSlider, setIsResizingSlider] = useState(false);
  const {
    containerRef,
    handleMouseDown: handleViewportMouseDown,
    handleWheel,
    imageTransformStyle,
    resetViewport,
    zoom,
    zoomIn,
    zoomOut,
  } = usePreviewViewport({ maxZoom: 4, minZoom: 0.5, transitionLocked: isResizingSlider, zoomStep: 0.5 });

  useEffect(() => {
    if (!isResizingSlider) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      setSliderPosition((x / rect.width) * 100);
    };

    const handleWindowMouseUp = () => {
      setIsResizingSlider(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [containerRef, isResizingSlider]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isResizingSlider) return;
    handleViewportMouseDown(e);
  };

  const handleSliderMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizingSlider(true);
  };

  const handleSliderKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        setSliderPosition((value) => Math.max(0, value - step));
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        setSliderPosition((value) => Math.min(100, value + step));
        break;
      case 'Home':
        e.preventDefault();
        setSliderPosition(0);
        break;
      case 'End':
        e.preventDefault();
        setSliderPosition(100);
        break;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#111] rounded-lg overflow-hidden border border-surface">
      <div className="h-9 bg-bg-primary border-b border-surface flex items-center justify-between px-3">
        <UiText as="div" variant={TextVariants.small} className="flex items-center gap-2">
          <Move size={14} /> <span>{t('modals.denoise.panZoomEnabled')}</span>
        </UiText>
        <UiText as="div" variant={TextVariants.small} className="flex items-center gap-2">
          <button onClick={zoomOut} className="hover:text-text-primary">
            <ZoomOut size={16} />
          </button>
          <span className="w-10 text-center">{(zoom * 100).toFixed(0)}%</span>
          <button onClick={zoomIn} className="hover:text-text-primary">
            <ZoomIn size={16} />
          </button>
          <button
            onClick={() => {
              resetViewport();
              setSliderPosition(50);
            }}
            className="ml-2 text-accent hover:underline"
          >
            {t('modals.denoise.reset')}
          </button>
        </UiText>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
        role="presentation"
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
      >
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
          <div className="origin-center" style={imageTransformStyle}>
            <img
              src={denoised}
              alt={t('modals.denoise.denoised')}
              className="max-w-none shadow-xl"
              style={{ height: 'auto' }}
              draggable={false}
            />
          </div>
        </div>

        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none"
          style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
        >
          <div className="origin-center" style={imageTransformStyle}>
            <img
              src={original}
              alt={t('modals.denoise.original')}
              className="max-w-none shadow-xl"
              style={{ height: 'auto' }}
              draggable={false}
            />
          </div>
        </div>

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white cursor-col-resize z-10 shadow-[0_0_8px_rgba(0,0,0,0.8)]"
          style={{ left: `${sliderPosition}%` }}
          role="slider"
          tabIndex={0}
          aria-label={t('modals.denoise.compareSplit')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(sliderPosition)}
          onMouseDown={handleSliderMouseDown}
          onKeyDown={handleSliderKeyDown}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center gap-0.5">
            <div className="w-0.5 h-3 bg-black/40 rounded-full"></div>
            <div className="w-0.5 h-3 bg-black/40 rounded-full"></div>
          </div>
        </div>

        <UiText
          as="div"
          variant={TextVariants.small}
          color={TextColors.white}
          weight={TextWeights.medium}
          className="absolute top-3 left-3 bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded-md pointer-events-none z-0"
        >
          {t('modals.denoise.original')}
        </UiText>
        <UiText
          as="div"
          variant={TextVariants.small}
          color={TextColors.button}
          weight={TextWeights.medium}
          className="absolute top-3 right-3 bg-accent/90 backdrop-blur-xs px-2.5 py-1 rounded-md pointer-events-none z-0"
        >
          {t('modals.denoise.denoised')}
        </UiText>
      </div>
    </div>
  );
};

export default function DenoiseModal({
  isOpen,
  onClose,
  onDenoise,
  onBatchDenoise,
  onSave,
  onOpenFile,
  error,
  previewBase64,
  originalBase64,
  isProcessing,
  progressMessage,
  aiModelDownloadStatus,
  isRaw,
  loadingImageUrl,
  targetPaths,
}: DenoiseModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const [intensity, setIntensity] = useState<number>(15);
  const [method, setMethod] = useState<'ai' | 'bm3d'>('ai');
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [batchSavedPaths, setBatchSavedPaths] = useState<string[] | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; path: string } | null>(null);
  const hasDenoiseTargets = targetPaths.length > 0;
  const isBatch = targetPaths.length > 1;
  const denoiseSourceCount = targetPaths.length;
  const mouseDownTarget = useRef<EventTarget | null>(null);

  const methodOptions = useMemo<Array<{ label: string; value: 'ai' | 'bm3d' }>>(
    () => [
      { label: t('modals.denoise.methodAi'), value: 'ai' },
      { label: t('modals.denoise.methodBm3d'), value: 'bm3d' },
    ],
    [t],
  );

  useEffect(() => {
    const unlisten = listen<unknown>('denoise-batch-progress', (event) => {
      setBatchProgress(parsePathProgressPayload(event.payload));
    });
    return () => {
      void unlisten
        .then((f) => {
          f();
        })
        .catch((error: unknown) => {
          console.error('Failed to unlisten denoise progress:', error);
        });
    };
  }, []);

  const currentStatusText =
    isBatch && batchProgress
      ? t('modals.denoise.batchProgressText', { current: batchProgress.current, total: batchProgress.total })
      : aiModelDownloadStatus?.includes('NIND')
        ? t('modals.denoise.downloadingText', { status: aiModelDownloadStatus })
        : progressMessage || t('modals.denoise.initializing');
  const batchProgressFileName = batchProgress?.path.split(/[\\/]/).pop() ?? '';
  const selectedMethodLabel = methodOptions.find((option) => option.value === method)?.label ?? '';
  const selectedMethodDescription =
    method === 'ai' ? t('modals.denoise.methodAiDescription') : t('modals.denoise.methodBm3dDescription');
  const savedOutputName = savedPath ? getDisplayFileName(savedPath) : '';
  const batchSavedCount = batchSavedPaths?.length ?? 0;
  const firstBatchSavedPath = batchSavedPaths?.[0] ?? null;
  const firstBatchSavedOutputName = firstBatchSavedPath ? getDisplayFileName(firstBatchSavedPath) : '';

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        setMethod(isRaw ? 'ai' : 'bm3d');
        setIntensity(isRaw ? 50 : 15);
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      setSavedPath(null);
      setBatchSavedPaths(null);
      setIsSaving(false);
      setBatchProgress(null);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, isRaw]);

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

  const handleRunDenoise = async () => {
    if (!hasDenoiseTargets) return;
    setSavedPath(null);
    setBatchSavedPaths(null);
    setBatchProgress(null);
    if (isBatch) {
      setIsSaving(true);
      try {
        const paths = await onBatchDenoise(intensity / 100, method, targetPaths);
        setBatchSavedPaths(paths);
      } catch (e) {
        console.error('Batch denoise failed:', e);
      } finally {
        setIsSaving(false);
        setBatchProgress(null);
      }
    } else {
      onDenoise(intensity / 100, method);
    }
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
            {t('modals.denoise.processingFailed')}
          </UiText>
          <UiText className="text-center p-4 rounded-lg bg-bg-primary max-w-md mt-2 leading-relaxed">{error}</UiText>
        </div>
      );
    }

    if (isBatch && batchSavedPaths) {
      return (
        <div className="flex h-[460px] flex-col items-center justify-center rounded-lg border border-surface bg-bg-primary px-10 text-center">
          <CheckCircle aria-hidden="true" className="mb-4 h-12 w-12 text-green-500" />
          <UiText variant={TextVariants.title} className="mb-2 text-center">
            {t('modals.denoise.batchCompleteTitle')}
          </UiText>
          <UiText
            className="text-center"
            data-saved-output-count={batchSavedCount}
            data-testid="denoise-batch-completion-summary"
          >
            {t('modals.denoise.batchCompleteSummary', { count: batchSavedCount })}
          </UiText>
          {firstBatchSavedPath && (
            <UiText
              as="div"
              variant={TextVariants.small}
              color={TextColors.secondary}
              className="mt-3 max-w-full truncate font-mono"
              data-saved-output-name={firstBatchSavedOutputName}
              data-testid="denoise-batch-first-output"
              title={firstBatchSavedPath}
            >
              {t('modals.common.savedOutputLabel', { name: firstBatchSavedOutputName })}
              <span className="sr-only">{t('modals.common.savedOutputFullPath', { path: firstBatchSavedPath })}</span>
            </UiText>
          )}
        </div>
      );
    }

    if (previewBase64 && originalBase64 && !isProcessing && !isBatch) {
      return (
        <div className="w-full h-[500px]">
          <ImageCompare original={originalBase64} denoised={previewBase64} />
          {savedPath && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <UiText
                as="div"
                variant={TextVariants.heading}
                color={TextColors.success}
                className="flex items-center justify-center gap-2 mt-4"
              >
                <CheckCircle aria-hidden="true" className="w-5 h-5" />
                <span>{t('modals.denoise.saveSuccess')}</span>
              </UiText>
              <UiText
                as="div"
                variant={TextVariants.small}
                color={TextColors.secondary}
                className="mx-auto mt-2 block max-w-full truncate text-center font-mono"
                data-saved-output-name={savedOutputName}
                data-testid="denoise-saved-output-detail"
                title={savedPath}
              >
                {t('modals.common.savedOutputLabel', { name: savedOutputName })}
                <span className="sr-only">{t('modals.common.savedOutputFullPath', { path: savedPath })}</span>
              </UiText>
            </motion.div>
          )}
        </div>
      );
    }

    if (isProcessing || (isBatch && isSaving)) {
      return (
        <div className="flex h-[460px] overflow-hidden rounded-lg border border-surface">
          <div className="w-2/5 relative overflow-hidden shrink-0 bg-[#0a0a0a] flex items-center justify-center">
            {loadingImageUrl ? (
              <img
                src={loadingImageUrl}
                alt={t('modals.denoise.selectedPreviewAlt')}
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
                {t('modals.denoise.denoisingProgress')}
              </UiText>
              <UiText className="text-center font-mono h-6 flex justify-center items-center">
                {currentStatusText}
              </UiText>
              {isBatch && batchProgressFileName && (
                <UiText
                  variant={TextVariants.small}
                  color={TextColors.secondary}
                  className="mt-1 max-w-xs truncate text-center"
                  data-testid="denoise-batch-progress-file"
                >
                  {t('modals.denoise.batchProgressFile', { fileName: batchProgressFileName })}
                </UiText>
              )}

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

              <UiText
                variant={TextVariants.small}
                data-tooltip={t('modals.denoise.gpuWarningTooltip')}
                className="mt-6 text-center max-w-xs opacity-60"
              >
                {t('modals.denoise.speedNotice')}
              </UiText>
            </motion.div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-[460px]">
        <div className="flex items-center justify-center mb-6">
          <Grip className="w-12 h-12 text-accent" />
        </div>
        <UiText variant={TextVariants.title} className="mb-3 text-center">
          {isBatch ? t('modals.denoise.titleBatch') : t('modals.denoise.titleSingle')}
        </UiText>
        <UiText className="text-center max-w-md leading-relaxed">{t('modals.denoise.description')}</UiText>
        <section
          className="mt-6 grid w-full max-w-xl grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-xs"
          data-denoise-method={method}
          data-denoise-source-count={denoiseSourceCount}
          data-is-batch={String(isBatch)}
          data-testid="denoise-setup-summary"
        >
          {[
            {
              label: t('modals.denoise.summaryMethod'),
              value: selectedMethodLabel,
            },
            {
              label: t('modals.denoise.summaryIntensity'),
              value: t('modals.denoise.summaryIntensityValue', { value: intensity }),
            },
            {
              label: t('modals.denoise.summarySourceMode'),
              value: isBatch ? t('modals.denoise.summaryBatch') : t('modals.denoise.summarySingle'),
            },
            {
              label: t('modals.denoise.summarySources'),
              value: t('modals.denoise.summarySourceCount', { count: denoiseSourceCount }),
            },
            {
              label: t('modals.denoise.summarySourceFormat'),
              value: isRaw ? t('modals.denoise.summaryRaw') : t('modals.denoise.summaryRaster'),
            },
            {
              label: t('modals.denoise.summaryWorkload'),
              value: t('modals.denoise.summaryWorkloadValue', {
                count: denoiseSourceCount,
                method: selectedMethodLabel,
              }),
            },
          ].map((item) => (
            <div className="rounded border border-border-color bg-bg-secondary px-2 py-1.5" key={item.label}>
              <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
                {item.label}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
                {item.value}
              </UiText>
            </div>
          ))}
        </section>
        {!hasDenoiseTargets && (
          <div
            className="mt-3 w-full max-w-xl rounded-md border border-border-color bg-bg-primary p-3 text-center"
            data-testid="denoise-empty-target-guard"
          >
            <UiText variant={TextVariants.small} color={TextColors.secondary}>
              {t('modals.denoise.emptyTarget')}
            </UiText>
          </div>
        )}
        {hasDenoiseTargets && loadingImageUrl && (
          <section
            className="mt-3 flex w-full max-w-xl items-center gap-3 rounded-md border border-border-color bg-bg-primary p-3"
            data-denoise-preview-source-count={denoiseSourceCount}
            data-testid="denoise-setup-preview"
          >
            <img
              src={loadingImageUrl}
              alt={t('modals.denoise.setupPreviewAlt')}
              className="h-16 w-16 shrink-0 rounded object-cover"
            />
            <div className="min-w-0">
              <UiText variant={TextVariants.small} className="block text-text-tertiary">
                {t('modals.denoise.setupPreview')}
              </UiText>
              <UiText variant={TextVariants.small} className="block truncate text-text-primary">
                {t('modals.denoise.setupPreviewCount', { count: denoiseSourceCount })}
              </UiText>
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderButtons = () => {
    if (error) {
      return (
        <Button onClick={handleClose} className="w-full">
          {t('modals.denoise.close')}
        </Button>
      );
    }

    if (batchSavedPaths) {
      return (
        <div className="w-full flex justify-end" data-testid="denoise-batch-completion-actions">
          <Button onClick={handleClose}>{t('modals.denoise.close')}</Button>
        </div>
      );
    }

    if (savedPath) {
      return (
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors"
          >
            {t('modals.denoise.close')}
          </button>
          <Button onClick={handleOpen}>{t('modals.denoise.openInEditor')}</Button>
        </>
      );
    }

    const disabled = isProcessing || isSaving;
    const canRunDenoise = hasDenoiseTargets && !disabled;

    return (
      <div className={`w-full flex items-center gap-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex-1 flex items-center gap-6">
          <div className="flex flex-col gap-1 w-[280px] mt-2 shrink-0">
            <UiText variant={TextVariants.body} weight={TextWeights.medium}>
              {t('modals.denoise.methodLabel')}
            </UiText>
            <Dropdown
              options={methodOptions}
              value={method}
              onChange={(val) => {
                setMethod(val);
                setIntensity(val === 'ai' ? 50 : 15);
              }}
            />
            <UiText
              variant={TextVariants.small}
              color={TextColors.secondary}
              className="leading-snug"
              data-denoise-method-guidance={method}
            >
              {selectedMethodDescription}
            </UiText>
          </div>
          <div className="flex-1 max-w-[280px]">
            <Slider
              label={method === 'ai' ? t('modals.denoise.qualityTileSizeLabel') : t('modals.denoise.strengthLabel')}
              value={intensity}
              min={0}
              max={100}
              step={1}
              defaultValue={method === 'ai' ? 50 : 15}
              onChange={(e) => {
                setIntensity(Number(e.target.value));
              }}
              trackClassName="bg-bg-secondary"
              fillOrigin="min"
            />
          </div>
        </div>

        <div className="h-10 w-px bg-surface shrink-0" />

        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
          >
            {previewBase64 ? t('modals.denoise.close') : t('modals.denoise.cancel')}
          </button>

          <Button
            onClick={() => {
              void handleRunDenoise();
            }}
            disabled={!canRunDenoise}
            variant={previewBase64 && !isBatch ? 'secondary' : 'primary'}
          >
            {isProcessing || (isBatch && isSaving) ? (
              <Loader2 className="animate-spin mr-2" size={16} />
            ) : previewBase64 && !isBatch ? (
              <RefreshCw className="mr-2" size={16} />
            ) : (
              <Grip className="mr-2" size={16} />
            )}
            {isBatch
              ? t('modals.denoise.btnBatchDenoise')
              : previewBase64
                ? t('modals.denoise.btnRetry')
                : t('modals.denoise.btnStart')}
          </Button>

          {previewBase64 && !isBatch && (
            <Button
              onClick={() => {
                void handleSave();
              }}
              disabled={isSaving || isProcessing}
            >
              {isSaving ? <Loader2 className="animate-spin mr-2" size={16} /> : <Save className="mr-2" size={16} />}
              {t('modals.denoise.btnSave')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className={`bg-surface rounded-xl shadow-2xl p-6 w-full max-w-4xl transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
      >
        <div className="flex flex-col">
          {renderContent()}
          <div
            className={`mt-4 flex justify-end gap-3 ${savedPath || batchSavedPaths ? '' : 'pt-4 border-t border-surface/50'}`}
          >
            {renderButtons()}
          </div>
        </div>
      </div>
    </div>
  );
}
