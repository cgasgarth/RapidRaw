import cx from 'clsx';
import {
  Aperture,
  Check,
  Eye,
  EyeOff,
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
import { Orientation, Panel } from '../../../ui/AppProperties';
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
const sectionTitleClassName = cx(token.typography.inspectorLabel, 'text-text-primary');
const utilityLabelClassName = cx(token.typography.utilityLabel, 'text-text-tertiary');
const iconButtonClassName = cx(
  token.button.base,
  token.button.iconCompact,
  token.button.quiet,
  token.focusRing,
  token.button.disabled,
);
const selectedControlClassName =
  'border-editor-primary-active bg-editor-selected-quiet text-editor-selected-quiet-text';
const quietControlClassName =
  'border-editor-border bg-editor-panel-raised text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary';
const ratioButtonClassName = cx(
  token.button.base,
  token.focusRing,
  token.button.disabled,
  'h-8 min-w-0 px-1.5 text-xs leading-4',
);

export default function CropPanel() {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const adjustments = useEditorStore((s) => s.adjustments);
  const isStraightenActive = useEditorStore((s) => s.isStraightenActive);
  const activeOverlay = useEditorStore((s) => s.overlayMode);
  const overlayRotation = useEditorStore((s) => s.overlayRotation);
  const showOriginal = useEditorStore((s) => s.showOriginal);
  const setEditor = useEditorStore((s) => s.setEditor);
  const isLensModalOpen = useUIStore((s) => s.isLensCorrectionModalOpen);
  const isTransformModalOpen = useUIStore((s) => s.isTransformModalOpen);
  const setUI = useUIStore((s) => s.setUI);
  const setRightPanel = useUIStore((s) => s.setRightPanel);
  const { setAdjustments } = useEditorActions();
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const [isRotationActive, setIsRotationActive] = useState(false);
  const [preferPortrait, setPreferPortrait] = useState(false);
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [customRatioError, setCustomRatioError] = useState(false);

  const [localRotation, setLocalRotation] = useState<number | null>(null);
  const localRotationRef = useRef<number | null>(null);
  const sessionAdjustmentsRef = useRef<Adjustments | null>(null);
  const sessionOverlayRef = useRef<{ mode: OverlayMode; rotation: number } | null>(null);
  const selectedImagePath = selectedImage?.path ?? null;

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
    return () => {
      setEditor({ liveRotation: null });
    };
  }, [setEditor]);

  useEffect(() => {
    const state = useEditorStore.getState();
    sessionAdjustmentsRef.current = structuredClone(state.adjustments);
    sessionOverlayRef.current = { mode: state.overlayMode, rotation: state.overlayRotation };
    setCustomRatioError(false);
  }, [selectedImagePath]);

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
    setCustomRatioError(false);
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
      setCustomRatioError(false);
      const newAspectRatio = numW / numH;
      lastSyncedRatio.current = newAspectRatio;
      if (!adjustments.aspectRatio || Math.abs(adjustments.aspectRatio - newAspectRatio) > RATIO_TOLERANCE) {
        setAdjustments((prev: Adjustments) => ({ ...prev, aspectRatio: newAspectRatio }));
      }
    } else {
      setCustomRatioError(true);
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
    setCustomRatioError(false);
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

  const activeRatioLabel = activePreset?.name ?? t('editor.crop.presets.custom.name');
  const orientationLabel =
    orientation === Orientation.Vertical ? t('editor.crop.status.portrait') : t('editor.crop.status.landscape');
  const activeOverlayLabel = OVERLAYS.find((overlay) => overlay.id === activeOverlay)?.name ?? activeOverlay;
  const isDirty =
    sessionAdjustmentsRef.current !== null &&
    (JSON.stringify(sessionAdjustmentsRef.current) !== JSON.stringify(adjustments) ||
      sessionOverlayRef.current?.mode !== activeOverlay ||
      sessionOverlayRef.current.rotation !== overlayRotation);

  const finalizeLiveRotation = () => {
    if (localRotationRef.current === null) return;

    const finalRotation = localRotationRef.current;
    updateLocalRotation(null);
    setAdjustments((prev: Adjustments) => ({ ...prev, rotation: finalRotation }));
  };

  const handleApply = () => {
    finalizeLiveRotation();
    setEditor({ isRotationActive: false, isStraightenActive: false, liveRotation: null });
    setRightPanel(Panel.Adjustments);
  };

  const handleCancel = () => {
    const sessionAdjustments = sessionAdjustmentsRef.current;
    const sessionOverlay = sessionOverlayRef.current;
    updateLocalRotation(null);
    if (sessionOverlay !== null) {
      setEditor({
        isRotationActive: false,
        isStraightenActive: false,
        liveRotation: null,
        overlayMode: sessionOverlay.mode,
        overlayRotation: sessionOverlay.rotation,
      });
    } else {
      setEditor({ isRotationActive: false, isStraightenActive: false, liveRotation: null });
    }
    if (sessionAdjustments !== null && JSON.stringify(sessionAdjustments) !== JSON.stringify(adjustments)) {
      setAdjustments(() => structuredClone(sessionAdjustments));
    }
    setRightPanel(Panel.Adjustments);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || e.ctrlKey || e.metaKey) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleCancel();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
        return;
      }

      if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        if (e.shiftKey) {
          setOverlayRotation((prev) => (prev + 1) % 4);
        } else {
          handleOverlayCycle();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeOverlay, adjustments, handleApply, handleCancel, setOverlayRotation]);

  return (
    <div className="flex h-full flex-col bg-editor-panel">
      <div
        className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-editor-border px-3 py-2"
        data-crop-dirty={String(isDirty)}
        data-testid="crop-panel-status"
      >
        <div className="min-w-0">
          <UiText variant={TextVariants.title} className={token.typography.panelTitle}>
            {t('editor.crop.title')}
          </UiText>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            <span className={editorChromeStatusChipClassName(isDirty ? 'info' : 'neutral')}>{activeRatioLabel}</span>
            <span className={editorChromeStatusChipClassName(isStraightenActive ? 'info' : 'neutral')}>
              {isStraightenActive ? t('editor.crop.status.straighten') : activeOverlayLabel}
            </span>
            <span className={editorChromeStatusChipClassName('neutral')}>{orientationLabel}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label={
              showOriginal ? t('editor.toolbar.tooltips.showEdited') : t('editor.toolbar.tooltips.showOriginal')
            }
            aria-pressed={showOriginal}
            className={cx(iconButtonClassName, showOriginal && selectedControlClassName)}
            data-tooltip={
              showOriginal ? t('editor.toolbar.tooltips.showEdited') : t('editor.toolbar.tooltips.showOriginal')
            }
            disabled={!selectedImage?.isReady}
            onClick={() => {
              setEditor({ showOriginal: !showOriginal });
            }}
            type="button"
          >
            {showOriginal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button
            aria-label={t('editor.crop.resetTooltip')}
            className={iconButtonClassName}
            data-tooltip={t('editor.crop.resetTooltip')}
            disabled={!selectedImage?.isReady}
            onClick={handleReset}
            type="button"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <div className="grow overflow-y-auto p-3">
        {selectedImage?.isReady ? (
          <>
            <section className="space-y-2 border-b border-editor-border pb-3" data-testid="crop-panel-ratio-section">
              <div className="flex min-h-7 items-center justify-between gap-2">
                <div>
                  <UiText variant={TextVariants.heading} className={sectionTitleClassName}>
                    {t('editor.crop.aspectRatioHeading')}
                  </UiText>
                  <div className={utilityLabelClassName}>{orientationLabel}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    aria-label={getOverlayTooltip()}
                    className={iconButtonClassName}
                    onClick={handleOverlayCycle}
                    data-tooltip={getOverlayTooltip()}
                    data-testid="crop-panel-overlay-cycle"
                    type="button"
                  >
                    <Grid3x3 size={16} />
                  </button>
                  <button
                    aria-label={getOrientationTooltip()}
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
              <div className="grid grid-cols-4 gap-1" role="group" aria-label={t('editor.crop.aspectRatioHeading')}>
                {PRESETS.map((preset: CropPreset) => (
                  <button
                    className={cx(
                      ratioButtonClassName,
                      isPresetActive(preset) ? selectedControlClassName : quietControlClassName,
                    )}
                    key={preset.name}
                    onClick={() => {
                      handlePresetClick(preset);
                    }}
                    data-tooltip={preset.tooltip}
                    data-testid={`crop-ratio-preset-${preset.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`}
                    aria-pressed={isPresetActive(preset)}
                    type="button"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <div>
                <button
                  className={cx(
                    ratioButtonClassName,
                    'w-full justify-between',
                    isCustomActive ? selectedControlClassName : quietControlClassName,
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
                    setCustomRatioError(false);
                  }}
                  data-tooltip={t('editor.crop.presets.custom.tooltip')}
                  data-testid="crop-ratio-preset-custom"
                  aria-pressed={isCustomActive}
                  type="button"
                >
                  <span>{t('editor.crop.presets.custom.name')}</span>
                  <span className={cx(token.typography.numericValue, 'text-xs opacity-80')}>
                    {customW && customH ? `${customW}:${customH}` : '1.62:1'}
                  </span>
                </button>
                {isCustomActive && (
                  <div className="mt-2" data-state="active" data-testid="crop-custom-ratio-inputs">
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
                      <input
                        aria-describedby="crop-custom-ratio-error"
                        aria-invalid={customRatioError}
                        className={cx(
                          token.input.base,
                          token.input.compact,
                          token.input.numeric,
                          token.focusRing,
                          'min-w-0 text-center',
                        )}
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
                      <X size={14} className={`shrink-0 ${TEXT_COLOR_KEYS[TextColors.secondary]}`} />
                      <input
                        aria-describedby="crop-custom-ratio-error"
                        aria-invalid={customRatioError}
                        className={cx(
                          token.input.base,
                          token.input.compact,
                          token.input.numeric,
                          token.focusRing,
                          'min-w-0 text-center',
                        )}
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
                    <div id="crop-custom-ratio-error" className="min-h-4 text-xs text-editor-warning" role="alert">
                      {customRatioError ? t('editor.crop.custom.invalid') : null}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-2 border-b border-editor-border py-3" data-testid="crop-panel-rotation-section">
              <div className="flex min-h-7 items-center justify-between gap-2">
                <UiText variant={TextVariants.heading} className={sectionTitleClassName}>
                  {t('editor.crop.rotationHeading')}
                </UiText>
                <span className={editorChromeStatusChipClassName(isRotationActive ? 'info' : 'neutral')}>
                  {displayRotation.toFixed(1)}°
                </span>
              </div>
              <Slider
                label={
                  <div className="flex items-center gap-1">
                    <button
                      aria-label={t('editor.crop.tooltips.straighten')}
                      aria-pressed={isStraightenActive}
                      className={cx(iconButtonClassName, isStraightenActive && selectedControlClassName)}
                      data-tooltip={t('editor.crop.tooltips.straighten')}
                      data-testid="crop-panel-straighten-toggle"
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
                      type="button"
                    >
                      <Ruler size={14} />
                    </button>
                    <button
                      aria-label={t('editor.crop.tooltips.resetFineRotation')}
                      className={iconButtonClassName}
                      data-tooltip={t('editor.crop.tooltips.resetFineRotation')}
                      data-testid="crop-panel-reset-fine-rotation"
                      disabled={displayRotation === 0}
                      onClick={resetFineRotation}
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
            </section>

            <section
              className="flex items-center justify-between gap-2 py-3"
              data-testid="crop-panel-orientation-section"
            >
              <div className="min-w-0">
                <UiText variant={TextVariants.heading} className={sectionTitleClassName}>
                  {t('editor.crop.orientationHeading')}
                </UiText>
                <div className={utilityLabelClassName}>{orientationSteps * 90}°</div>
              </div>
              <div
                className="flex shrink-0 items-center gap-1"
                role="group"
                aria-label={t('editor.crop.orientationHeading')}
              >
                <button
                  aria-label={t('editor.crop.tooltips.rotateLeft')}
                  className={iconButtonClassName}
                  data-tooltip={t('editor.crop.tooltips.rotateLeft')}
                  data-testid="crop-panel-rotate-left"
                  onClick={() => handleStepRotate(-90)}
                  type="button"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  aria-label={t('editor.crop.tooltips.rotateRight')}
                  className={iconButtonClassName}
                  data-tooltip={t('editor.crop.tooltips.rotateRight')}
                  data-testid="crop-panel-rotate-right"
                  onClick={() => handleStepRotate(90)}
                  type="button"
                >
                  <RotateCw size={16} />
                </button>
                <button
                  aria-label={t('editor.crop.tooltips.flipHoriz')}
                  aria-pressed={flipHorizontal}
                  className={cx(iconButtonClassName, flipHorizontal && selectedControlClassName)}
                  data-tooltip={t('editor.crop.tooltips.flipHoriz')}
                  data-testid="crop-panel-flip-horizontal"
                  onClick={() => {
                    setAdjustments((prev: Adjustments) => ({ ...prev, flipHorizontal: !prev.flipHorizontal }));
                  }}
                  type="button"
                >
                  <FlipHorizontal size={16} />
                </button>
                <button
                  aria-label={t('editor.crop.tooltips.flipVert')}
                  aria-pressed={flipVertical}
                  className={cx(iconButtonClassName, flipVertical && selectedControlClassName)}
                  data-tooltip={t('editor.crop.tooltips.flipVert')}
                  data-testid="crop-panel-flip-vertical"
                  onClick={() => {
                    setAdjustments((prev: Adjustments) => ({ ...prev, flipVertical: !prev.flipVertical }));
                  }}
                  type="button"
                >
                  <FlipVertical size={16} />
                </button>
                <span className="mx-0.5 h-5 border-l border-editor-border" aria-hidden="true" />
                <button
                  aria-label={t('editor.crop.tooltips.transform')}
                  className={iconButtonClassName}
                  data-tooltip={t('editor.crop.tooltips.transform')}
                  data-testid="crop-panel-transform-entry"
                  onClick={() => setUI({ isTransformModalOpen: true })}
                  type="button"
                >
                  <Scan size={16} />
                </button>
                <button
                  aria-label={t('editor.crop.tooltips.lens')}
                  className={iconButtonClassName}
                  data-tooltip={t('editor.crop.tooltips.lens')}
                  data-testid="crop-panel-lens-entry"
                  onClick={() => setUI({ isLensCorrectionModalOpen: true })}
                  type="button"
                >
                  <Aperture size={16} />
                </button>
              </div>
            </section>
          </>
        ) : selectedImage ? (
          <UiText
            aria-busy="true"
            className="mt-4 text-center"
            color={TextColors.secondary}
            variant={TextVariants.heading}
            weight={TextWeights.normal}
          >
            {t('editor.canvas.compare.loadingOriginal')}
          </UiText>
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

      <div
        className="flex shrink-0 items-center justify-between gap-2 border-t border-editor-border px-3 py-2"
        data-testid="crop-panel-actions"
      >
        <button
          aria-label={t('editor.crop.resetTooltip')}
          className={iconButtonClassName}
          data-tooltip={t('editor.crop.resetTooltip')}
          disabled={!selectedImage?.isReady}
          onClick={handleReset}
          type="button"
        >
          <RotateCcw size={16} />
        </button>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <button
            className={cx(
              token.button.base,
              token.button.quiet,
              token.focusRing,
              token.button.disabled,
              'h-8 px-3 text-xs',
            )}
            disabled={!selectedImage?.isReady}
            onClick={handleCancel}
            type="button"
          >
            {t('modals.transform.cancel')}
          </button>
          <button
            className={cx(
              token.button.base,
              token.focusRing,
              token.button.disabled,
              'h-8 bg-editor-primary-active px-3 text-xs text-editor-primary-active-text hover:opacity-90',
            )}
            disabled={!selectedImage?.isReady}
            onClick={handleApply}
            type="button"
          >
            <Check size={14} />
            {t('modals.transform.apply')}
          </button>
        </div>
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
