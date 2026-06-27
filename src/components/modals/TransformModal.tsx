import { invoke } from '@tauri-apps/api/core';
import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RotateCcw, Grid3X3, Eye, EyeOff, Info, LineChart, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import { usePreviewViewport } from '../../hooks/usePreviewViewport';
import { Invokes } from '../../tauri/commands';
import { TextColors, TextVariants } from '../../types/typography';
import { throttle } from '../../utils/timing';
import Button from '../ui/Button';
import Slider from '../ui/Slider';
import UiText from '../ui/Text';

import type { Adjustments } from '../../utils/adjustments';

interface GeometryParams {
  distortion: number;
  vertical: number;
  horizontal: number;
  rotate: number;
  aspect: number;
  scale: number;
  x_offset: number;
  y_offset: number;
  lens_distortion_amount: number;
  lens_vignette_amount: number;
  lens_tca_amount: number;
  lens_dist_k1: number;
  lens_dist_k2: number;
  lens_dist_k3: number;
  lens_model: number;
  tca_vr: number;
  tca_vb: number;
  vig_k1: number;
  vig_k2: number;
  vig_k3: number;
  lens_distortion_enabled: boolean;
  lens_tca_enabled: boolean;
  lens_vignette_enabled: boolean;
}

type TransformParams = Omit<
  GeometryParams,
  | 'lens_distortion_amount'
  | 'lens_vignette_amount'
  | 'lens_tca_amount'
  | 'lens_dist_k1'
  | 'lens_dist_k2'
  | 'lens_dist_k3'
  | 'lens_model'
  | 'tca_vr'
  | 'tca_vb'
  | 'vig_k1'
  | 'vig_k2'
  | 'vig_k3'
  | 'lens_distortion_enabled'
  | 'lens_tca_enabled'
  | 'lens_vignette_enabled'
>;

interface TransformModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (newParams: TransformParams) => void;
  currentAdjustments: Adjustments;
}

const DEFAULT_PARAMS: TransformParams = {
  distortion: 0,
  vertical: 0,
  horizontal: 0,
  rotate: 0,
  aspect: 0,
  scale: 100,
  x_offset: 0,
  y_offset: 0,
};

const SLIDER_DIVISOR = 100.0;

const CustomGrid = ({ denseVisible, ruleOfThirdsVisible }: { denseVisible: boolean; ruleOfThirdsVisible: boolean }) => (
  <div className="absolute inset-0 pointer-events-none w-full h-full z-10">
    <div
      className={cx(
        'absolute inset-0 w-full h-full transition-opacity duration-300 ease-in-out',
        ruleOfThirdsVisible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="absolute top-0 bottom-0 border-l border-white/40 left-1/3" />
      <div className="absolute top-0 bottom-0 border-l border-white/40 left-2/3" />
      <div className="absolute left-0 right-0 border-t border-white/40 top-1/3" />
      <div className="absolute left-0 right-0 border-t border-white/40 top-2/3" />
    </div>

    <div
      className={cx(
        'absolute inset-0 w-full h-full transition-opacity duration-500 ease-in-out',
        denseVisible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {Array.from({ length: 17 }, (_, i) => (
        <div
          key={`v-${i}`}
          className="absolute top-0 bottom-0 border-l border-white/40"
          style={{ left: `${(i + 1) * 5.555}%` }}
        />
      ))}
      {Array.from({ length: 17 }, (_, i) => (
        <div
          key={`h-${i}`}
          className="absolute left-0 right-0 border-t border-white/40"
          style={{ top: `${(i + 1) * 5.555}%` }}
        />
      ))}
    </div>
  </div>
);

export default function TransformModal({ isOpen, onClose, onApply, currentAdjustments }: TransformModalProps) {
  const { t } = useTranslation();
  const [params, setParams] = useState<TransformParams>(DEFAULT_PARAMS);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showLines, setShowLines] = useState(false);
  const [isCompareActive, setIsCompareActive] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);

  const { containerRef, handleMouseDown, handleResetZoom, handleWheel, imageTransformStyle, zoom, zoomIn, zoomOut } =
    usePreviewViewport({ maxZoom: 8, minZoom: 0.1, zoomStep: 0.25 });

  const { isMounted, show } = useModalTransition(isOpen);

  useEffect(() => {
    const handleDragEndGlobal = () => {
      if (isInteracting) setIsInteracting(false);
    };

    if (isInteracting) {
      window.addEventListener('mouseup', handleDragEndGlobal);
      window.addEventListener('touchend', handleDragEndGlobal);
    }

    return () => {
      window.removeEventListener('mouseup', handleDragEndGlobal);
      window.removeEventListener('touchend', handleDragEndGlobal);
    };
  }, [isInteracting]);

  const handleInteractionStart = useCallback(() => {
    setIsInteracting(true);
  }, []);

  const updatePreview = useMemo(
    () =>
      throttle(async (currentParams: TransformParams, linesEnabled: boolean) => {
        try {
          const fullParams: GeometryParams = {
            ...currentParams,
            lens_distortion_amount: currentAdjustments.lensDistortionAmount / SLIDER_DIVISOR,
            lens_vignette_amount: currentAdjustments.lensVignetteAmount / SLIDER_DIVISOR,
            lens_tca_amount: currentAdjustments.lensTcaAmount / SLIDER_DIVISOR,
            lens_dist_k1: currentAdjustments.lensDistortionParams?.k1 ?? 0,
            lens_dist_k2: currentAdjustments.lensDistortionParams?.k2 ?? 0,
            lens_dist_k3: currentAdjustments.lensDistortionParams?.k3 ?? 0,
            lens_model: currentAdjustments.lensDistortionParams?.model ?? 0,
            tca_vr: currentAdjustments.lensDistortionParams?.tca_vr ?? 1.0,
            tca_vb: currentAdjustments.lensDistortionParams?.tca_vb ?? 1.0,
            vig_k1: currentAdjustments.lensDistortionParams?.vig_k1 ?? 0,
            vig_k2: currentAdjustments.lensDistortionParams?.vig_k2 ?? 0,
            vig_k3: currentAdjustments.lensDistortionParams?.vig_k3 ?? 0,
            lens_distortion_enabled: currentAdjustments.lensDistortionEnabled,
            lens_tca_enabled: currentAdjustments.lensTcaEnabled,
            lens_vignette_enabled: currentAdjustments.lensVignetteEnabled,
          };

          const result: string = await invoke(Invokes.PreviewGeometryTransform, {
            params: fullParams,
            jsAdjustments: currentAdjustments,
            showLines: linesEnabled,
          });
          setPreviewUrl(result);
        } catch (e) {
          console.error('Preview transform failed', e);
        }
      }, 30),
    [currentAdjustments],
  );

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        const initParams = {
          distortion: currentAdjustments.transformDistortion,
          vertical: currentAdjustments.transformVertical,
          horizontal: currentAdjustments.transformHorizontal,
          rotate: currentAdjustments.transformRotate,
          aspect: currentAdjustments.transformAspect,
          scale: currentAdjustments.transformScale,
          x_offset: currentAdjustments.transformXOffset,
          y_offset: currentAdjustments.transformYOffset,
        };
        setParams(initParams);
        setShowLines(false);
        handleResetZoom();
        updatePreview(initParams, false);
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      setPreviewUrl(null);
      setIsApplying(false);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, currentAdjustments, handleResetZoom, updatePreview]);

  const handleChange = (key: keyof typeof DEFAULT_PARAMS, value: number) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    updatePreview(newParams, showLines);
  };

  const handleApply = () => {
    setIsApplying(true);
    try {
      onApply(params);
      onClose();
    } catch (e) {
      console.error('Failed to apply transform', e);
      setIsApplying(false);
    }
  };

  const handleReset = () => {
    setParams(DEFAULT_PARAMS);
    updatePreview(DEFAULT_PARAMS, showLines);
  };

  const handleShowLinesToggle = () => {
    const newShowLines = !showLines;
    setShowLines(newShowLines);
    updatePreview(params, newShowLines);
  };

  const toggleCompare = async (active: boolean) => {
    setIsCompareActive(active);
    if (active) {
      const fullParams: GeometryParams = {
        ...DEFAULT_PARAMS,
        lens_distortion_amount: currentAdjustments.lensDistortionAmount / SLIDER_DIVISOR,
        lens_vignette_amount: currentAdjustments.lensVignetteAmount / SLIDER_DIVISOR,
        lens_tca_amount: currentAdjustments.lensTcaAmount / SLIDER_DIVISOR,
        lens_dist_k1: currentAdjustments.lensDistortionParams?.k1 ?? 0,
        lens_dist_k2: currentAdjustments.lensDistortionParams?.k2 ?? 0,
        lens_dist_k3: currentAdjustments.lensDistortionParams?.k3 ?? 0,
        lens_model: currentAdjustments.lensDistortionParams?.model ?? 0,
        tca_vr: currentAdjustments.lensDistortionParams?.tca_vr ?? 1.0,
        tca_vb: currentAdjustments.lensDistortionParams?.tca_vb ?? 1.0,
        vig_k1: currentAdjustments.lensDistortionParams?.vig_k1 ?? 0,
        vig_k2: currentAdjustments.lensDistortionParams?.vig_k2 ?? 0,
        vig_k3: currentAdjustments.lensDistortionParams?.vig_k3 ?? 0,
        lens_distortion_enabled: currentAdjustments.lensDistortionEnabled,
        lens_tca_enabled: currentAdjustments.lensTcaEnabled,
        lens_vignette_enabled: currentAdjustments.lensVignetteEnabled,
      };
      const result: string = await invoke(Invokes.PreviewGeometryTransform, {
        params: fullParams,
        jsAdjustments: currentAdjustments,
        showLines: false,
      });
      setPreviewUrl(result);
    } else {
      updatePreview(params, showLines);
    }
  };

  const renderControls = () => (
    <div className="modal-adjustments-pane w-80 shrink-0 bg-bg-secondary flex flex-col border-l border-surface h-full z-10">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <UiText variant={TextVariants.title}>{t('modals.transform.title')}</UiText>
        <button
          onClick={handleReset}
          data-tooltip={t('modals.transform.resetTooltip')}
          className="p-2 rounded-full hover:bg-surface transition-colors"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="grow overflow-y-auto p-4 flex flex-col gap-8" onPointerDownCapture={handleInteractionStart}>
        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.transform.distortion')}
          </UiText>
          <div className="space-y-3">
            <Slider
              label={t('modals.transform.amount')}
              value={params.distortion}
              min={-100}
              max={100}
              defaultValue={0}
              step={1}
              onChange={(e) => {
                handleChange('distortion', Number(e.target.value));
              }}
            />
          </div>
        </div>

        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.transform.perspective')}
          </UiText>
          <div className="space-y-3">
            <Slider
              label={t('modals.transform.vertical')}
              value={params.vertical}
              min={-100}
              max={100}
              defaultValue={0}
              step={1}
              onChange={(e) => {
                handleChange('vertical', Number(e.target.value));
              }}
            />
            <Slider
              label={t('modals.transform.horizontal')}
              value={params.horizontal}
              min={-100}
              max={100}
              defaultValue={0}
              step={1}
              onChange={(e) => {
                handleChange('horizontal', Number(e.target.value));
              }}
            />
          </div>
        </div>

        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.transform.title')}
          </UiText>
          <div className="space-y-3">
            <Slider
              label={t('modals.transform.rotate')}
              value={params.rotate}
              min={-45}
              max={45}
              step={0.1}
              defaultValue={0}
              onChange={(e) => {
                handleChange('rotate', Number(e.target.value));
              }}
            />
            <Slider
              label={t('modals.transform.aspect')}
              value={params.aspect}
              min={-100}
              max={100}
              defaultValue={0}
              step={1}
              onChange={(e) => {
                handleChange('aspect', Number(e.target.value));
              }}
            />
            <Slider
              label={t('modals.transform.scale')}
              value={params.scale}
              min={50}
              max={150}
              defaultValue={100}
              step={1}
              onChange={(e) => {
                handleChange('scale', Number(e.target.value));
              }}
            />
          </div>
        </div>

        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.transform.offset')}
          </UiText>
          <div className="space-y-3">
            <Slider
              label={t('modals.transform.xAxis')}
              value={params.x_offset}
              min={-100}
              max={100}
              defaultValue={0}
              step={1}
              onChange={(e) => {
                handleChange('x_offset', Number(e.target.value));
              }}
            />
            <Slider
              label={t('modals.transform.yAxis')}
              value={params.y_offset}
              min={-100}
              max={100}
              defaultValue={0}
              step={1}
              onChange={(e) => {
                handleChange('y_offset', Number(e.target.value));
              }}
            />
          </div>
        </div>

        <div className="mt-auto">
          {currentAdjustments.masks.length > 0 && (
            <UiText
              as="div"
              variant={TextVariants.small}
              className="p-3 bg-surface rounded-md border border-surface flex items-center gap-3"
            >
              <Info size={16} className="shrink-0" />
              <p className="leading-relaxed">{t('modals.transform.maskWarning')}</p>
            </UiText>
          )}
        </div>
      </div>
    </div>
  );

  const renderContent = () => (
    <div className="modal-preview-adjustments flex flex-row h-full w-full overflow-hidden">
      <div className="modal-preview-pane grow flex flex-col relative min-h-0 bg-[#0f0f0f] overflow-hidden">
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
          role="presentation"
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
        >
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(#444 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          ></div>

          {previewUrl && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="origin-center" style={imageTransformStyle}>
                <div className="relative inline-block shadow-2xl">
                  <img
                    src={previewUrl}
                    className="block object-contain"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      width: 'auto',
                      height: 'auto',
                    }}
                    alt={t('modals.transform.previewAlt')}
                    draggable={false}
                  />

                  {!isCompareActive && (
                    <CustomGrid ruleOfThirdsVisible={showGrid} denseVisible={showGrid && isInteracting} />
                  )}

                  {isCompareActive && (
                    <UiText
                      as="div"
                      variant={TextVariants.small}
                      color={TextColors.button}
                      className="absolute top-4 left-4 bg-accent px-2 py-1 rounded-sm shadow-lg z-20"
                    >
                      {t('modals.transform.original')}
                    </UiText>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur-md p-1.5 rounded-full border border-white/10 shadow-xl z-20 pointer-events-auto"
            role="presentation"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <button
              onClick={() => {
                setShowGrid(!showGrid);
              }}
              className={cx(
                'p-2 rounded-full transition-colors',
                showGrid ? 'bg-white/20 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white',
              )}
              data-tooltip={t('modals.transform.toggleGridTooltip')}
            >
              <Grid3X3 size={18} />
            </button>
            <button
              onClick={handleShowLinesToggle}
              className={cx(
                'p-2 rounded-full transition-colors',
                showLines ? 'bg-white/20 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white',
              )}
              data-tooltip={t('modals.transform.toggleHelperLinesTooltip')}
            >
              <LineChart size={18} />
            </button>

            <div className="w-px h-5 bg-white/20 mx-1"></div>

            <button
              onClick={zoomOut}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.transform.zoomOutTooltip')}
            >
              <ZoomOut size={18} />
            </button>

            <span className="text-xs font-mono text-white/90 w-12 text-center select-none pointer-events-none">
              {Math.round(zoom * 100)}%
            </span>

            <button
              onClick={zoomIn}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.transform.zoomInTooltip')}
            >
              <ZoomIn size={18} />
            </button>

            <button
              onClick={handleResetZoom}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.transform.resetZoomTooltip')}
            >
              <Maximize size={16} />
            </button>

            <div className="w-px h-5 bg-white/20 mx-1"></div>

            <button
              onMouseDown={() => {
                void toggleCompare(true);
              }}
              onMouseUp={() => {
                void toggleCompare(false);
              }}
              onMouseLeave={() => {
                void toggleCompare(false);
              }}
              className={cx(
                'p-2 rounded-full transition-colors select-none',
                isCompareActive ? 'bg-accent text-button-text' : 'text-white/60 hover:bg-white/10 hover:text-white',
              )}
              data-tooltip={t('modals.transform.compareTooltip')}
            >
              {isCompareActive ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </div>
      </div>
      {renderControls()}
    </div>
  );

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs transition-opacity duration-300 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      role="presentation"
      onMouseDown={onClose}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-surface rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="grow min-h-0 overflow-hidden">{renderContent()}</div>
            <div className="shrink-0 p-4 flex justify-end gap-3 border-t border-surface bg-bg-secondary z-20">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
              >
                {t('modals.transform.cancel')}
              </button>
              <Button onClick={handleApply} disabled={isApplying || !previewUrl}>
                <Check className="mr-2" size={16} />
                {t('modals.transform.apply')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
