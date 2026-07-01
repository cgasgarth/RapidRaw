import cx from 'clsx';
import { motion } from 'framer-motion';
import {
  Aperture,
  FlipHorizontal,
  FlipVertical,
  Grid3x3,
  RectangleHorizontal,
  RectangleVertical,
  RotateCcw,
  RotateCw,
  Ruler,
  Scan,
  X,
} from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useUIStore } from '../../../../store/useUIStore';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../../../types/typography';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../../utils/adjustments';
import LensCorrectionModal from '../../../modals/editing/LensCorrectionModal';
import TransformModal from '../../../modals/editing/TransformModal';
import { Orientation } from '../../../ui/AppProperties';
import { editorChromeStatusChipClassName, editorChromeTokens } from '../../../ui/editorChromeTokens';
import Slider from '../../../ui/primitives/Slider';
import UiText from '../../../ui/primitives/Text';

const BASE_RATIO = 1.618;
const ORIGINAL_RATIO = 0;
const RATIO_TOLERANCE = 0.01;

export type OverlayMode = 'none' | 'thirds' | 'goldenTriangle' | 'goldenSpiral' | 'phiGrid' | 'armature' | 'diagonal';

interface CropPreset {
  name: string;
  value: number | null;
  tooltip: string;
}

interface OverlayOption {
  id: OverlayMode;
  name: string;
  tooltip: string;
}

type SliderChangeEvent =
  | ChangeEvent<HTMLInputElement>
  | {
      target: {
        value: number | string;
      };
    };

const token = editorChromeTokens;
const sectionClassName = 'space-y-3 rounded-md border border-editor-border bg-editor-panel-well p-3';
const sectionHeaderClassName = 'mb-1 flex min-h-7 items-center justify-between gap-2';
const sectionTitleClassName = cx(token.typography.inspectorLabel, 'text-text-primary');
const utilityLabelClassName = cx(token.typography.utilityLabel, 'text-text-tertiary');
const iconButtonClassName = cx(
  token.button.base,
  token.button.iconCompact,
  token.button.quiet,
  token.focusRing,
  token.button.disabled,
);
const tileButtonClassName = cx(
  token.button.base,
  token.focusRing,
  token.button.disabled,
  'min-h-10 w-full flex-col px-2 py-2 text-xs leading-4',
);
const selectedTileClassName = 'border-editor-primary-active bg-editor-selected-quiet text-editor-selected-quiet-text';
const quietTileClassName =
  'border-editor-border bg-editor-panel-raised text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary';
const ratioButtonClassName = cx(
  token.button.base,
  token.focusRing,
  token.button.disabled,
  'h-8 w-full px-2 text-xs leading-4',
);

export default function CropPanel() {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const adjustments = useEditorStore((s) => s.adjustments);
  const isStraightenActive = useEditorStore((s) => s.isStraightenActive);
  const activeOverlay = useEditorStore((s) => s.overlayMode);
  const setEditor = useEditorStore((s) => s.setEditor);
  const isLensModalOpen = useUIStore((s) => s.isLensCorrectionModalOpen);
  const isTransformModalOpen = useUIStore((s) => s.isTransformModalOpen);
  const setUI = useUIStore((s) => s.setUI);
  const { setAdjustments } = useEditorActions();
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const [isRotationActive, setIsRotationActive] = useState(false);
  const [preferPortrait, setPreferPortrait] = useState(false);
  const [isEditingCustom, setIsEditingCustom] = useState(false);

  const [localRotation, setLocalRotation] = useState<number | null>(null);
  const localRotationRef = useRef<number | null>(null);

  const PRESETS = useMemo<Array<CropPreset>>(
    () => [
      { name: t('editor.crop.presets.free.name'), value: null, tooltip: t('editor.crop.presets.free.desc') },
      {
        name: t('editor.crop.presets.original.name'),
        value: ORIGINAL_RATIO,
        tooltip: t('editor.crop.presets.original.desc'),
      },
      { name: t('editor.crop.presets.sq.name'), value: 1, tooltip: t('editor.crop.presets.sq.desc') },
      { name: t('editor.crop.presets.r54.name'), value: 5 / 4, tooltip: t('editor.crop.presets.r54.desc') },
      { name: t('editor.crop.presets.r43.name'), value: 4 / 3, tooltip: t('editor.crop.presets.r43.desc') },
      { name: t('editor.crop.presets.r32.name'), value: 3 / 2, tooltip: t('editor.crop.presets.r32.desc') },
      { name: t('editor.crop.presets.r169.name'), value: 16 / 9, tooltip: t('editor.crop.presets.r169.desc') },
      { name: t('editor.crop.presets.r219.name'), value: 21 / 9, tooltip: t('editor.crop.presets.r219.desc') },
      { name: t('editor.crop.presets.r6524.name'), value: 65 / 24, tooltip: t('editor.crop.presets.r6524.desc') },
    ],
    [t],
  );

  const OVERLAYS = useMemo<Array<OverlayOption>>(
    () => [
      { id: 'none', name: t('editor.crop.overlays.none.name'), tooltip: t('editor.crop.overlays.none.desc') },
      { id: 'thirds', name: t('editor.crop.overlays.thirds.name'), tooltip: t('editor.crop.overlays.thirds.desc') },
      {
        id: 'diagonal',
        name: t('editor.crop.overlays.diagonal.name'),
        tooltip: t('editor.crop.overlays.diagonal.desc'),
      },
      {
        id: 'goldenTriangle',
        name: t('editor.crop.overlays.triangle.name'),
        tooltip: t('editor.crop.overlays.triangle.desc'),
      },
      {
        id: 'goldenSpiral',
        name: t('editor.crop.overlays.spiral.name'),
        tooltip: t('editor.crop.overlays.spiral.desc'),
      },
      { id: 'phiGrid', name: t('editor.crop.overlays.phiGrid.name'), tooltip: t('editor.crop.overlays.phiGrid.desc') },
      {
        id: 'armature',
        name: t('editor.crop.overlays.armature.name'),
        tooltip: t('editor.crop.overlays.armature.desc'),
      },
    ],
    [t],
  );

  const updateLocalRotation = useCallback(
    (val: number | null) => {
      setLocalRotation(val);
      localRotationRef.current = val;
      setEditor({ liveRotation: val });
    },
    [setEditor],
  );

  const setOverlay = useCallback(
    (mode: OverlayMode) => {
      setEditor({ overlayMode: mode });
    },
    [setEditor],
  );

  const setOverlayRotation = useCallback(
    (updater: React.SetStateAction<number>) => {
      setEditor((state) => ({
        overlayRotation: typeof updater === 'function' ? updater(state.overlayRotation) : updater,
      }));
    },
    [setEditor],
  );

  const lastSyncedRatio = useRef<number | null>(null);

  const { aspectRatio, rotation, flipHorizontal, flipVertical, orientationSteps } = adjustments;

  useEffect(() => {
    if (!isStraightenActive) return;

    const syncTimer = setTimeout(() => {
      updateLocalRotation(null);
      setAdjustments((prev: Adjustments) => ({ ...prev, rotation: 0 }));
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [isStraightenActive, setAdjustments, updateLocalRotation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.ctrlKey || e.metaKey) return;

      if (e.key.toLowerCase() === 'o') {
        e.preventDefault();

        if (e.shiftKey) {
          setOverlayRotation((prev) => (prev + 1) % 4);
        } else {
          const currentIndex = OVERLAYS.findIndex((o) => o.id === activeOverlay);
          const nextIndex = (currentIndex + 1) % OVERLAYS.length;
          const nextOverlay = OVERLAYS[nextIndex];
          if (nextOverlay) setOverlay(nextOverlay.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeOverlay, setOverlay, setOverlayRotation, OVERLAYS]);

  useEffect(() => {
    return () => {
      setEditor({ liveRotation: null });
    };
  }, [setEditor]);

  const getEffectiveOriginalRatio = useCallback(() => {
    if (selectedImage === null || !selectedImage.width || !selectedImage.height) {
      return null;
    }
    const isSwapped = orientationSteps === 1 || orientationSteps === 3;
    const W = isSwapped ? selectedImage.height : selectedImage.width;
    const H = isSwapped ? selectedImage.width : selectedImage.height;
    return W > 0 && H > 0 ? W / H : null;
  }, [selectedImage, orientationSteps]);

  const activePreset = useMemo(() => {
    if (aspectRatio === null) {
      return PRESETS.find((p: CropPreset) => p.value === null);
    }

    const numericPresetMatch = PRESETS.find(
      (p: CropPreset) =>
        p.value &&
        p.value !== ORIGINAL_RATIO &&
        (Math.abs(aspectRatio - p.value) < RATIO_TOLERANCE || Math.abs(aspectRatio - 1 / p.value) < RATIO_TOLERANCE),
    );

    if (numericPresetMatch) {
      return numericPresetMatch;
    }

    const originalRatio = getEffectiveOriginalRatio();
    if (originalRatio && Math.abs(aspectRatio - originalRatio) < RATIO_TOLERANCE) {
      return PRESETS.find((p: CropPreset) => p.value === ORIGINAL_RATIO);
    }

    return null;
  }, [aspectRatio, getEffectiveOriginalRatio, PRESETS]);

  let orientation = Orientation.Horizontal;
  if (activePreset && activePreset.value && activePreset.value !== 1) {
    let baseRatio: number | null = activePreset.value;
    if (activePreset.value === ORIGINAL_RATIO) {
      baseRatio = getEffectiveOriginalRatio();
    }
    if (baseRatio && aspectRatio && Math.abs(aspectRatio - baseRatio) > RATIO_TOLERANCE) {
      orientation = Orientation.Vertical;
    }
  }

  const isCustomActive = aspectRatio !== null && !activePreset;

  useEffect(() => {
    if (!aspectRatio || aspectRatio === 1) return;

    const syncTimer = setTimeout(() => {
      setPreferPortrait(aspectRatio < 1);
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [aspectRatio]);

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      if (isCustomActive && aspectRatio && !isEditingCustom) {
        if (lastSyncedRatio.current === null || Math.abs(lastSyncedRatio.current - aspectRatio) > RATIO_TOLERANCE) {
          const h = 100;
          const w = aspectRatio * h;
          setCustomW(w.toFixed(1).replace(/\.0$/, ''));
          setCustomH(h.toString());
          lastSyncedRatio.current = aspectRatio;
        }
      } else if (!isCustomActive) {
        setCustomW('');
        setCustomH('');
        lastSyncedRatio.current = null;
      }
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [isCustomActive, aspectRatio, isEditingCustom]);

  useEffect(() => {
    if (activePreset?.value === ORIGINAL_RATIO) {
      const newOriginalRatio = getEffectiveOriginalRatio();
      if (newOriginalRatio !== null && aspectRatio && Math.abs(aspectRatio - newOriginalRatio) > RATIO_TOLERANCE) {
        setAdjustments((prev: Adjustments) => ({ ...prev, aspectRatio: newOriginalRatio }));
      }
    }
  }, [orientationSteps, activePreset, aspectRatio, getEffectiveOriginalRatio, setAdjustments]);

  const handleCustomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'customW') {
      setCustomW(value);
    } else if (name === 'customH') {
      setCustomH(value);
    }
  };

  const handleCustomInputFocus = () => {
    setIsEditingCustom(true);
  };

  const handleApplyCustomRatio = () => {
    setIsEditingCustom(false);
    const numW = parseFloat(customW);
    const numH = parseFloat(customH);

    if (numW > 0 && numH > 0) {
      const newAspectRatio = numW / numH;
      lastSyncedRatio.current = newAspectRatio;
      if (!adjustments.aspectRatio || Math.abs(adjustments.aspectRatio - newAspectRatio) > RATIO_TOLERANCE) {
        setAdjustments((prev: Adjustments) => ({ ...prev, aspectRatio: newAspectRatio }));
      }
    }
  };

  const handleCustomInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApplyCustomRatio();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setIsEditingCustom(false);
      if (aspectRatio) {
        const h = 100;
        const w = aspectRatio * h;
        setCustomW(w.toFixed(1).replace(/\.0$/, ''));
        setCustomH(h.toString());
      }
      (e.target as HTMLInputElement).blur();
    }
  };

  const handlePresetClick = (preset: CropPreset) => {
    if (preset.value === ORIGINAL_RATIO) {
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        aspectRatio: getEffectiveOriginalRatio(),
      }));
      return;
    }

    const targetRatio = preset.value;
    if (activePreset === preset && targetRatio && targetRatio !== 1) {
      const newRatio = 1 / (adjustments.aspectRatio ? adjustments.aspectRatio : 1);
      setPreferPortrait(newRatio < 1);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        aspectRatio: newRatio,
      }));
      return;
    }

    let newAspectRatio = targetRatio;
    if (targetRatio && targetRatio !== 1) {
      if (preferPortrait) {
        newAspectRatio = targetRatio > 1 ? 1 / targetRatio : targetRatio;
      } else {
        newAspectRatio = targetRatio > 1 ? targetRatio : targetRatio;
      }
    }

    setAdjustments((prev: Adjustments) => ({ ...prev, aspectRatio: newAspectRatio }));
  };

  const handleOrientationToggle = useCallback(() => {
    if (aspectRatio && aspectRatio !== 1) {
      const newRatio = 1 / aspectRatio;
      setPreferPortrait(newRatio < 1);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        aspectRatio: newRatio,
      }));
    }
  }, [aspectRatio, setAdjustments]);

  const handleReset = () => {
    const originalAspectRatio =
      selectedImage !== null && selectedImage.width && selectedImage.height
        ? selectedImage.width / selectedImage.height
        : null;

    setPreferPortrait(false);
    setIsEditingCustom(false);
    lastSyncedRatio.current = null;
    updateLocalRotation(null);

    setOverlay('thirds');

    setAdjustments((prev: Adjustments) => ({
      ...prev,
      aspectRatio: originalAspectRatio,
      crop: INITIAL_ADJUSTMENTS.crop,
      flipHorizontal: INITIAL_ADJUSTMENTS.flipHorizontal,
      flipVertical: INITIAL_ADJUSTMENTS.flipVertical,
      orientationSteps: INITIAL_ADJUSTMENTS.orientationSteps,
      rotation: INITIAL_ADJUSTMENTS.rotation,
      transformDistortion: INITIAL_ADJUSTMENTS.transformDistortion,
      transformVertical: INITIAL_ADJUSTMENTS.transformVertical,
      transformHorizontal: INITIAL_ADJUSTMENTS.transformHorizontal,
      transformRotate: INITIAL_ADJUSTMENTS.transformRotate,
      transformAspect: INITIAL_ADJUSTMENTS.transformAspect,
      transformScale: INITIAL_ADJUSTMENTS.transformScale,
      transformXOffset: INITIAL_ADJUSTMENTS.transformXOffset,
      transformYOffset: INITIAL_ADJUSTMENTS.transformYOffset,
      lensMaker: INITIAL_ADJUSTMENTS.lensMaker,
      lensModel: INITIAL_ADJUSTMENTS.lensModel,
      lensDistortionAmount: INITIAL_ADJUSTMENTS.lensDistortionAmount,
      lensVignetteAmount: INITIAL_ADJUSTMENTS.lensVignetteAmount,
      lensTcaAmount: INITIAL_ADJUSTMENTS.lensTcaAmount,
      lensDistortionEnabled: INITIAL_ADJUSTMENTS.lensDistortionEnabled,
      lensTcaEnabled: INITIAL_ADJUSTMENTS.lensTcaEnabled,
      lensVignetteEnabled: INITIAL_ADJUSTMENTS.lensVignetteEnabled,
      lensDistortionParams: INITIAL_ADJUSTMENTS.lensDistortionParams,
    }));
  };

  const isPresetActive = (preset: CropPreset) => preset === activePreset;
  const isOrientationToggleDisabled = !aspectRatio || aspectRatio === 1 || activePreset?.value === ORIGINAL_RATIO;

  const fineRotation = useMemo(() => {
    return rotation || 0;
  }, [rotation]);

  const displayRotation = localRotation !== null ? localRotation : fineRotation;

  const handleFineRotationChange = (e: SliderChangeEvent) => {
    const newFineRotation = parseFloat(String(e.target.value));
    if (isRotationActive) {
      updateLocalRotation(newFineRotation);
    } else {
      setAdjustments((prev: Adjustments) => ({ ...prev, rotation: newFineRotation }));
    }
  };

  const handleStepRotate = (degrees: number) => {
    const increment = degrees > 0 ? 1 : 3;
    setAdjustments((prev: Adjustments) => {
      const newAspectRatio = prev.aspectRatio && prev.aspectRatio !== 0 ? 1 / prev.aspectRatio : null;
      return {
        ...prev,
        aspectRatio: newAspectRatio,
        orientationSteps: ((prev.orientationSteps || 0) + increment) % 4,
        rotation: 0,
      };
    });
  };

  const resetFineRotation = () => {
    updateLocalRotation(null);
    setAdjustments((prev: Adjustments) => ({ ...prev, rotation: 0 }));
  };

  const handleOverlayCycle = () => {
    const currentIndex = OVERLAYS.findIndex((o) => o.id === activeOverlay);
    const nextIndex = (currentIndex + 1) % OVERLAYS.length;
    const nextOverlay = OVERLAYS[nextIndex];
    if (nextOverlay) setOverlay(nextOverlay.id);
  };

  const getOverlayTooltip = () => {
    const current = OVERLAYS.find((o) => o.id === activeOverlay);
    if (!current) return t('editor.crop.tooltips.compositionOverlay');
    const isRotatable = ['goldenSpiral', 'goldenTriangle'].includes(activeOverlay);
    const rotateHint = isRotatable ? t('editor.crop.tooltips.rotateHint') : '';
    return t('editor.crop.tooltips.overlayDetails', { name: current.name, rotateHint });
  };

  const getOrientationTooltip = () => {
    if (isOrientationToggleDisabled) {
      return t('editor.crop.tooltips.switchOrientation');
    }
    return orientation === Orientation.Vertical
      ? t('editor.crop.tooltips.switchToLandscape')
      : t('editor.crop.tooltips.switchToPortrait');
  };

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => {
      if (isDragging) {
        setIsRotationActive(true);
        setEditor({ isRotationActive: true });
      } else {
        setIsRotationActive(false);
        setEditor({ isRotationActive: false });
        if (localRotationRef.current !== null) {
          const finalRot = localRotationRef.current;
          updateLocalRotation(null);
          setAdjustments((prev: Adjustments) => ({ ...prev, rotation: finalRot }));
        }
      }
    },
    [setEditor, updateLocalRotation, setAdjustments],
  );

  const activeRatioLabel = activePreset?.name ?? (isCustomActive ? t('editor.crop.presets.custom.name') : 'Custom');
  const orientationLabel = orientation === Orientation.Vertical ? 'Portrait' : 'Landscape';
  const activeOverlayLabel = OVERLAYS.find((overlay) => overlay.id === activeOverlay)?.name ?? activeOverlay;

  return (
    <div className="flex h-full flex-col bg-editor-panel">
      <div className="flex min-h-11 shrink-0 items-center justify-between border-b border-editor-border px-3">
        <div className="min-w-0">
          <UiText variant={TextVariants.title} className={token.typography.panelTitle}>
            {t('editor.crop.title')}
          </UiText>
          {selectedImage && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className={editorChromeStatusChipClassName('neutral')}>{activeRatioLabel}</span>
              <span className={editorChromeStatusChipClassName(isStraightenActive ? 'info' : 'neutral')}>
                {isStraightenActive ? 'Straighten' : activeOverlayLabel}
              </span>
            </div>
          )}
        </div>
        <button
          className={iconButtonClassName}
          onClick={handleReset}
          data-tooltip={t('editor.crop.resetTooltip')}
          type="button"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="grow space-y-3 overflow-y-auto p-3">
        {selectedImage ? (
          <>
            <section className={sectionClassName} data-testid="crop-panel-ratio-section">
              <div className={sectionHeaderClassName}>
                <div>
                  <UiText variant={TextVariants.heading} className={sectionTitleClassName}>
                    {t('editor.crop.aspectRatioHeading')}
                  </UiText>
                  <div className={utilityLabelClassName}>{orientationLabel}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className={iconButtonClassName}
                    onClick={handleOverlayCycle}
                    data-tooltip={getOverlayTooltip()}
                    data-testid="crop-panel-overlay-cycle"
                    type="button"
                  >
                    <Grid3x3 size={16} />
                  </button>
                  <button
                    className={iconButtonClassName}
                    disabled={isOrientationToggleDisabled}
                    onClick={handleOrientationToggle}
                    data-tooltip={getOrientationTooltip()}
                    data-testid="crop-panel-ratio-orientation-toggle"
                    type="button"
                  >
                    {orientation === Orientation.Vertical ? (
                      <RectangleVertical size={16} />
                    ) : (
                      <RectangleHorizontal size={16} />
                    )}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {PRESETS.map((preset: CropPreset) => (
                  <motion.button
                    className={cx(
                      ratioButtonClassName,
                      isPresetActive(preset) ? selectedTileClassName : quietTileClassName,
                    )}
                    key={preset.name}
                    onClick={() => {
                      handlePresetClick(preset);
                    }}
                    data-tooltip={preset.tooltip}
                    data-testid={`crop-ratio-preset-${preset.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`}
                    aria-pressed={isPresetActive(preset)}
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                  >
                    {preset.name}
                  </motion.button>
                ))}
              </div>
              <div>
                <motion.button
                  className={cx(
                    ratioButtonClassName,
                    'justify-between',
                    isCustomActive ? selectedTileClassName : quietTileClassName,
                  )}
                  onClick={() => {
                    const imageRatio = getEffectiveOriginalRatio();
                    let newAspectRatio = BASE_RATIO;
                    if (preferPortrait || (imageRatio && imageRatio < 1)) {
                      newAspectRatio = 1 / BASE_RATIO;
                    }
                    setAdjustments((prev: Adjustments) => ({
                      ...prev,
                      aspectRatio: newAspectRatio,
                    }));
                  }}
                  data-tooltip={t('editor.crop.presets.custom.tooltip')}
                  data-testid="crop-ratio-preset-custom"
                  aria-pressed={isCustomActive}
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <span>{t('editor.crop.presets.custom.name')}</span>
                  <span className={cx(token.typography.numericValue, 'text-xs opacity-80')}>
                    {customW && customH ? `${customW}:${customH}` : '1.62:1'}
                  </span>
                </motion.button>
                <div
                  className={cx(
                    'mt-2 rounded border border-editor-border bg-editor-panel-raised p-2 transition-opacity',
                    isCustomActive ? 'opacity-100' : 'opacity-50',
                  )}
                  data-state={isCustomActive ? 'active' : 'disabled'}
                  data-testid="crop-custom-ratio-inputs"
                >
                  <div className="flex items-center justify-center gap-2">
                    <input
                      className={cx(
                        token.input.base,
                        token.input.compact,
                        token.input.numeric,
                        token.focusRing,
                        'w-full text-center',
                      )}
                      disabled={!isCustomActive}
                      min="0"
                      name="customW"
                      onBlur={handleApplyCustomRatio}
                      onChange={handleCustomInputChange}
                      onFocus={handleCustomInputFocus}
                      onKeyDown={handleCustomInputKeyDown}
                      placeholder={t('editor.crop.custom.wPlaceholder')}
                      data-tooltip={t('editor.crop.custom.wTooltip')}
                      type="number"
                      value={customW}
                    />
                    <X size={16} className={`shrink-0 ${TEXT_COLOR_KEYS[TextColors.secondary]}`} />
                    <input
                      className={cx(
                        token.input.base,
                        token.input.compact,
                        token.input.numeric,
                        token.focusRing,
                        'w-full text-center',
                      )}
                      disabled={!isCustomActive}
                      min="0"
                      name="customH"
                      onBlur={handleApplyCustomRatio}
                      onChange={handleCustomInputChange}
                      onFocus={handleCustomInputFocus}
                      onKeyDown={handleCustomInputKeyDown}
                      placeholder={t('editor.crop.custom.hPlaceholder')}
                      data-tooltip={t('editor.crop.custom.hTooltip')}
                      type="number"
                      value={customH}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className={sectionClassName} data-testid="crop-panel-rotation-section">
              <div className={sectionHeaderClassName}>
                <UiText variant={TextVariants.heading} className={sectionTitleClassName}>
                  {t('editor.crop.rotationHeading')}
                </UiText>
                <span className={editorChromeStatusChipClassName(isRotationActive ? 'info' : 'neutral')}>
                  {displayRotation.toFixed(1)}°
                </span>
              </div>
              <div className="rounded border border-editor-border bg-editor-panel-raised px-3 py-3">
                <Slider
                  label={
                    <div className="flex items-center gap-2">
                      <button
                        aria-label={t('editor.crop.tooltips.straighten')}
                        onClick={() => {
                          setEditor((state) => {
                            const willBeActive = !state.isStraightenActive;
                            if (willBeActive) {
                              updateLocalRotation(null);
                              setAdjustments((prev: Adjustments) => ({ ...prev, rotation: 0 }));
                            }
                            return { isStraightenActive: willBeActive };
                          });
                        }}
                        className={cx(
                          iconButtonClassName,
                          isStraightenActive ? selectedTileClassName : token.button.quiet,
                        )}
                        data-tooltip={t('editor.crop.tooltips.straighten')}
                        data-testid="crop-panel-straighten-toggle"
                        type="button"
                      >
                        <Ruler size={14} />
                      </button>
                      <button
                        aria-label={t('editor.crop.tooltips.resetFineRotation')}
                        className={iconButtonClassName}
                        onClick={resetFineRotation}
                        data-tooltip={t('editor.crop.tooltips.resetFineRotation')}
                        disabled={displayRotation === 0}
                        data-testid="crop-panel-reset-fine-rotation"
                        type="button"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  }
                  min={-45}
                  max={45}
                  step={0.1}
                  value={displayRotation}
                  defaultValue={0}
                  suffix="°"
                  onChange={handleFineRotationChange}
                  onDragStateChange={handleDragStateChange}
                />
              </div>
            </section>

            <section className={sectionClassName} data-testid="crop-panel-orientation-section">
              <div className={sectionHeaderClassName}>
                <UiText variant={TextVariants.heading} className={sectionTitleClassName}>
                  {t('editor.crop.orientationHeading')}
                </UiText>
                <span className={editorChromeStatusChipClassName(flipHorizontal || flipVertical ? 'info' : 'neutral')}>
                  {orientationSteps * 90}°
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <motion.button
                  className={cx(tileButtonClassName, quietTileClassName)}
                  onClick={() => {
                    handleStepRotate(-90);
                  }}
                  data-tooltip={t('editor.crop.tooltips.rotateLeft')}
                  data-testid="crop-panel-rotate-left"
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <RotateCcw size={20} className="transition-none" />
                  <span className="text-xs mt-2 transition-none">{t('editor.crop.labels.rotateLeft')}</span>
                </motion.button>
                <motion.button
                  className={cx(tileButtonClassName, quietTileClassName)}
                  onClick={() => {
                    handleStepRotate(90);
                  }}
                  data-tooltip={t('editor.crop.tooltips.rotateRight')}
                  data-testid="crop-panel-rotate-right"
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <RotateCw size={20} className="transition-none" />
                  <span className="text-xs mt-2 transition-none">{t('editor.crop.labels.rotateRight')}</span>
                </motion.button>
                <motion.button
                  className={cx(tileButtonClassName, flipHorizontal ? selectedTileClassName : quietTileClassName)}
                  onClick={() => {
                    setAdjustments((prev: Adjustments) => ({
                      ...prev,
                      flipHorizontal: !prev.flipHorizontal,
                    }));
                  }}
                  data-tooltip={t('editor.crop.tooltips.flipHoriz')}
                  data-testid="crop-panel-flip-horizontal"
                  aria-pressed={flipHorizontal}
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <FlipHorizontal size={20} className="transition-none" />
                  <span className="text-xs mt-2 transition-none">{t('editor.crop.labels.flipHoriz')}</span>
                </motion.button>
                <motion.button
                  className={cx(tileButtonClassName, flipVertical ? selectedTileClassName : quietTileClassName)}
                  onClick={() => {
                    setAdjustments((prev: Adjustments) => ({ ...prev, flipVertical: !prev.flipVertical }));
                  }}
                  data-tooltip={t('editor.crop.tooltips.flipVert')}
                  data-testid="crop-panel-flip-vertical"
                  aria-pressed={flipVertical}
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <FlipVertical size={20} className="transition-none" />
                  <span className="text-xs mt-2 transition-none">{t('editor.crop.labels.flipVert')}</span>
                </motion.button>
              </div>
            </section>

            <section className={sectionClassName} data-testid="crop-panel-geometry-section">
              <div className={sectionHeaderClassName}>
                <UiText variant={TextVariants.heading} className={sectionTitleClassName}>
                  {t('editor.crop.geometryHeading')}
                </UiText>
                <span className={editorChromeStatusChipClassName('neutral')}>{t('editor.crop.geometryHeading')}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <motion.button
                  className={cx(tileButtonClassName, quietTileClassName)}
                  onClick={() => {
                    setUI({ isTransformModalOpen: true });
                  }}
                  data-tooltip={t('editor.crop.tooltips.transform')}
                  data-testid="crop-panel-transform-entry"
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <Scan size={20} className="transition-none" />
                  <span className="text-xs mt-2 transition-none">{t('editor.crop.labels.transform')}</span>
                </motion.button>
                <motion.button
                  className={cx(tileButtonClassName, quietTileClassName)}
                  onClick={() => {
                    setUI({ isLensCorrectionModalOpen: true });
                  }}
                  data-tooltip={t('editor.crop.tooltips.lens')}
                  data-testid="crop-panel-lens-entry"
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <Aperture size={20} className="transition-none" />
                  <span className="text-xs mt-2 transition-none">{t('editor.crop.labels.lens')}</span>
                </motion.button>
              </div>
            </section>
          </>
        ) : (
          <UiText
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="text-center mt-4"
          >
            {t('editor.ai.noImageSelected')}
          </UiText>
        )}
      </div>

      <TransformModal
        isOpen={isTransformModalOpen}
        onClose={() => {
          setUI({ isTransformModalOpen: false });
        }}
        onApply={(newParams) => {
          setAdjustments((prev: Adjustments) => ({
            ...prev,
            transformDistortion: newParams.distortion,
            transformVertical: newParams.vertical,
            transformHorizontal: newParams.horizontal,
            transformRotate: newParams.rotate,
            transformAspect: newParams.aspect,
            transformScale: newParams.scale,
            transformXOffset: newParams.x_offset,
            transformYOffset: newParams.y_offset,
          }));
        }}
        currentAdjustments={adjustments}
      />

      <LensCorrectionModal
        isOpen={isLensModalOpen}
        onClose={() => {
          setUI({ isLensCorrectionModalOpen: false });
        }}
        onApply={(newParams) => {
          setAdjustments((prev: Adjustments) => ({
            ...prev,
            ...newParams,
          }));
        }}
        currentAdjustments={adjustments}
        selectedImage={selectedImage}
      />
    </div>
  );
}
