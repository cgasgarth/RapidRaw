import { invoke } from '@tauri-apps/api/core';
import cx from 'clsx';
import { Loader2 } from 'lucide-react';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
  useImperativeHandle,
  type MouseEvent,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

import EditorToolbar from './editor/EditorToolbar';
import ImageCanvas from './editor/ImageCanvas';
import { Mask, type SubMask } from './right/Masks';
import { useAiMasking } from '../../hooks/useAiMasking';
import {
  type BaseRenderSize,
  type ImageDimensions,
  type RenderSize,
  useImageRenderSize,
} from '../../hooks/useImageRenderSize';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { calculateCenteredCrop } from '../../utils/cropUtils';
import { normalizeMaskOverlaySettings } from '../../utils/maskOverlayModes';
import { toMaskParameterRecord } from '../../utils/maskParameterAccess';
import { debounce } from '../../utils/timing';
import { Panel, type TransformState, Invokes } from '../ui/AppProperties';

import type { Adjustments, AiPatch, MaskContainer } from '../../utils/adjustments';
import type { Crop, PercentCrop } from 'react-image-crop';

const parseRgb = (rgbStr: string): [number, number, number, number] => {
  const match = rgbStr.match(/[\d.]+/g);
  const [r, g, b] = match ?? [];
  if (r !== undefined && g !== undefined && b !== undefined) {
    return [parseFloat(r) / 255, parseFloat(g) / 255, parseFloat(b) / 255, 1.0];
  }
  return [0, 0, 0, 1.0];
};

const checkCropValid = (pixelCrop: Partial<Crop>, imageW: number, imageH: number, rotation: number) => {
  if (pixelCrop.x === undefined || pixelCrop.y === undefined || !pixelCrop.width || !pixelCrop.height) {
    return false;
  }

  const cx = imageW / 2;
  const cy = imageH / 2;
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const pts = [
    { x: pixelCrop.x, y: pixelCrop.y },
    { x: pixelCrop.x + pixelCrop.width, y: pixelCrop.y },
    { x: pixelCrop.x, y: pixelCrop.y + pixelCrop.height },
    { x: pixelCrop.x + pixelCrop.width, y: pixelCrop.y + pixelCrop.height },
  ];

  for (const p of pts) {
    const nx = cos * (p.x - cx) - sin * (p.y - cy) + cx;
    const ny = sin * (p.x - cx) + cos * (p.y - cy) + cy;
    if (nx < -1 || nx > imageW + 1 || ny < -1 || ny > imageH + 1) {
      return false;
    }
  }
  return true;
};

interface WgpuRenderState {
  useWgpuRenderer: boolean | undefined;
  isReady: boolean;
  hasRenderedFirstFrame: boolean;
  isCropping: boolean;
  uncroppedAdjustedPreviewUrl: string | null;
  showOriginal: boolean;
  bgPrimary: [number, number, number, number];
  bgSecondary: [number, number, number, number];
}

interface TransformController {
  resetTransform(time?: number): void;
  setTransform(x: number, y: number, scale: number, time?: number): void;
  zoomIn(factor: number, time?: number): void;
  zoomOut(factor: number, time?: number): void;
}

interface DisplaySizeUpdate extends BaseRenderSize {
  scale: number;
}

interface CropGeometryParams {
  aspectRatio: number | null;
  orientationSteps: number;
  rotation: number;
}

type MaskPreviewDefinition =
  | (Omit<MaskContainer, 'adjustments'> & { adjustments: Partial<Adjustments> })
  | (AiPatch & { adjustments?: Partial<Adjustments>; opacity?: number });
type SerializableMaskParameters = Record<string, unknown> & {
  mask_data_base64?: string | null | undefined;
  maskDataBase64?: string | null | undefined;
};

interface MaskOverlayRequest {
  jsAdjustments: Adjustments;
  maskDef: MaskPreviewDefinition;
  renderSize: RenderSize;
}

interface EditorProps {
  onBackToLibrary: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  transformWrapperRef: RefObject<TransformController | null>;
}

export default function Editor({ onBackToLibrary, onContextMenu, transformWrapperRef }: EditorProps) {
  const { t } = useTranslation();
  const appSettings = useSettingsStore((s) => s.appSettings);
  const osPlatform = useSettingsStore((s) => s.osPlatform);
  const isFullScreen = useUIStore((s) => s.isFullScreen);
  const activeRightPanel = useUIStore((s) => s.activeRightPanel);
  const isInstantTransition = useUIStore((s) => s.isInstantTransition);
  const setUI = useUIStore((s) => s.setUI);
  const isLoading = useLibraryStore((s) => s.isViewLoading);
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const adjustments = useEditorStore((s) => s.adjustments);
  const adjustmentsHistory = useEditorStore((s) => s.history);
  const adjustmentsHistoryIndex = useEditorStore((s) => s.historyIndex);
  const finalPreviewUrl = useEditorStore((s) => s.finalPreviewUrl);
  const uncroppedAdjustedPreviewUrl = useEditorStore((s) => s.uncroppedAdjustedPreviewUrl);
  const transformedOriginalUrl = useEditorStore((s) => s.transformedOriginalUrl);
  const interactivePatch = useEditorStore((s) => s.interactivePatch);
  const showOriginal = useEditorStore((s) => s.showOriginal);
  const isSliderDragging = useEditorStore((s) => s.isSliderDragging);
  const targetZoom = useEditorStore((s) => s.zoom);
  const isRotationActive = useEditorStore((s) => s.isRotationActive);
  const overlayMode = useEditorStore((s) => s.overlayMode);
  const overlayRotation = useEditorStore((s) => s.overlayRotation);
  const maskOverlaySettings = useEditorStore((s) => s.maskOverlaySettings);
  const isStraightenActive = useEditorStore((s) => s.isStraightenActive);
  const isWbPickerActive = useEditorStore((s) => s.isWbPickerActive);
  const liveRotation = useEditorStore((s) => s.liveRotation);
  const brushSettings = useEditorStore((s) => s.brushSettings);
  const activeMaskContainerId = useEditorStore((s) => s.activeMaskContainerId);
  const activeMaskId = useEditorStore((s) => s.activeMaskId);
  const activeAiPatchContainerId = useEditorStore((s) => s.activeAiPatchContainerId);
  const activeAiSubMaskId = useEditorStore((s) => s.activeAiSubMaskId);
  const isMaskControlHovered = useEditorStore((s) => s.isMaskControlHovered);
  const hasRenderedFirstFrame = useEditorStore((s) => s.hasRenderedFirstFrame);

  const setEditor = useEditorStore((s) => s.setEditor);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const goToHistoryIndex = useEditorStore((s) => s.goToHistoryIndex);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const canUndo = adjustmentsHistoryIndex > 0;
  const canRedo = adjustmentsHistoryIndex < adjustmentsHistory.length - 1;

  const isAndroid = osPlatform === 'android';

  const debouncedSetHistory = useMemo(
    () =>
      debounce((newAdj: Adjustments) => {
        pushHistory(newAdj);
      }, 500),
    [pushHistory],
  );

  const setAdjustments = useCallback(
    (value: Partial<Adjustments> | ((prev: Adjustments) => Adjustments)) => {
      setEditor((state) => {
        const prevAdjustments = state.adjustments;
        const newAdjustments = typeof value === 'function' ? value(prevAdjustments) : { ...prevAdjustments, ...value };
        debouncedSetHistory(newAdjustments);
        return { adjustments: newAdjustments };
      });
    },
    [debouncedSetHistory, setEditor],
  );
  const { handleGenerateAiMask, handleQuickErase } = useAiMasking();
  const [crop, setCrop] = useState<Crop | null>(null);
  const prevCropParams = useRef<CropGeometryParams | null>(null);
  const lastValidCropRef = useRef<PercentCrop | null>(null);

  const [isMaskHovered, setIsMaskHovered] = useState(false);
  const [isMaskTouchInteracting, setIsMaskTouchInteracting] = useState(false);
  const [isLoaderVisible, setIsLoaderVisible] = useState(false);
  const [showExifDateView, setShowExifDateView] = useState(false);
  const [maskOverlayUrl, setMaskOverlayUrl] = useState<string | null>(null);
  const [transformState, setTransformState] = useState<TransformState>({ scale: 1, positionX: 0, positionY: 0 });

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const transformStateRef = useRef<TransformState>(transformState);
  const [isPanningState, setIsPanningState] = useState(false);
  const [isMiddleMousePanningState, setIsMiddleMousePanningState] = useState(false);
  const isClickAnimating = useRef(false);
  const clickAnimationTime = 250;
  const zoomDebounceTimeoutRef = useRef<number | null>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const savedZoomState = useRef<{ scale: number; positionX: number; positionY: number } | null>(null);
  const focalPointRef = useRef({ x: 0.5, y: 0.5 });
  const isTransitioningRef = useRef(false);
  const [toolbarOverflowVisible, setToolbarOverflowVisible] = useState(!isFullScreen);
  const isGeneratingOverlayRef = useRef(false);
  const pendingOverlayRequestRef = useRef<MaskOverlayRequest | null>(null);
  const processOverlayQueueRef = useRef<() => Promise<void>>(async () => {});
  const animationFrameId = useRef<number | null>(null);
  const physicsFrameId = useRef<number | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPanPos = useRef<{ x: number; y: number } | null>(null);
  const lastPinch = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const panVelocityHistory = useRef<{ x: number; y: number; t: number }[]>([]);
  const wheelSnapTimeout = useRef<number | null>(null);
  const isMiddleMousePanning = useRef(false);
  const wasPanningDisabledOnDown = useRef(false);

  const prevRenderState = useRef({
    containerLeft: 0,
    containerTop: 0,
    offsetX: 0,
    offsetY: 0,
    width: 0,
  });
  const transitionAnchorRef = useRef<{
    active: boolean;
    screenImageLeft: number;
    screenImageTop: number;
    physicalImageWidth: number;
  } | null>(null);
  const wgpuSyncRef = useRef<number | null>(null);
  const lastWgpuTransformRef = useRef<string | null>(null);

  const toggleShowOriginal = useCallback(() => {
    setEditor((state) => ({ showOriginal: !state.showOriginal }));
  }, [setEditor]);

  const handleToggleFullScreen = useCallback(() => {
    const currentlyZoomed = targetZoom > 1.01;
    setUI({ isInstantTransition: currentlyZoomed });

    if (isFullScreen) {
      setUI({ isFullScreen: false });
    } else {
      if (selectedImage) setUI({ isFullScreen: true });
    }

    if (currentlyZoomed) {
      setTimeout(() => {
        setUI({ isInstantTransition: false });
      }, 100);
    }
  }, [isFullScreen, selectedImage, targetZoom, setUI]);

  const handleDisplaySizeChange = useCallback(
    (size: DisplaySizeUpdate) => {
      setEditor({ displaySize: { width: size.width, height: size.height } });
      if (size.scale) {
        const baseWidth = size.width / size.scale;
        const baseHeight = size.height / size.scale;
        const newSize = {
          width: baseWidth,
          height: baseHeight,
          offsetX: size.offsetX || 0,
          offsetY: size.offsetY || 0,
          containerWidth: size.containerWidth || 0,
          containerHeight: size.containerHeight || 0,
        };
        setEditor({ baseRenderSize: newSize });
      }
    },
    [setEditor],
  );

  const handleZoomed = useCallback(
    (state: TransformState) => {
      setEditor({ zoom: state.scale });
    },
    [setEditor],
  );

  const handleStraighten = useCallback(
    (angleCorrection: number) => {
      setAdjustments((prev: Adjustments) => {
        const newRotation = (prev.rotation || 0) + angleCorrection;
        return { ...prev, rotation: newRotation };
      });
      setEditor({ isStraightenActive: false });
    },
    [setAdjustments, setEditor],
  );

  const updateSubMaskLocal = useCallback(
    (subMaskId: string | null, updatedData: Partial<SubMask>) => {
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        masks: prev.masks.map((c: MaskContainer) => ({
          ...c,
          subMasks: c.subMasks.map((sm: SubMask) => (sm.id === subMaskId ? { ...sm, ...updatedData } : sm)),
        })),
        aiPatches: prev.aiPatches.map((p: AiPatch) => ({
          ...p,
          subMasks: p.subMasks.map((sm: SubMask) => (sm.id === subMaskId ? { ...sm, ...updatedData } : sm)),
        })),
      }));
    },
    [setAdjustments],
  );

  const handleWbPicked = useCallback(() => {}, []);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setToolbarOverflowVisible(!isFullScreen);
      },
      isFullScreen ? 0 : 300,
    );

    return () => {
      clearTimeout(timer);
    };
  }, [isFullScreen]);

  const isCropping = activeRightPanel === Panel.Crop;
  const isMasking = activeRightPanel === Panel.Masks;
  const isAiEditing = activeRightPanel === Panel.Ai;

  const croppedDimensions = useMemo<ImageDimensions | null>(() => {
    if (!selectedImage || !selectedImage.width || !selectedImage.height) {
      return null;
    }
    if (adjustments.crop) {
      return { width: adjustments.crop.width, height: adjustments.crop.height };
    }
    const orientationSteps = adjustments.orientationSteps || 0;
    const isSwapped = orientationSteps === 1 || orientationSteps === 3;
    const width = isSwapped ? selectedImage.height : selectedImage.width;
    const height = isSwapped ? selectedImage.width : selectedImage.height;
    return { width, height };
  }, [selectedImage, adjustments.crop, adjustments.orientationSteps]);

  const imageRenderSize = useImageRenderSize(imageContainerRef, croppedDimensions);
  const imageRenderSizeRef = useRef(imageRenderSize);
  useLayoutEffect(() => {
    transformStateRef.current = transformState;
    imageRenderSizeRef.current = imageRenderSize;
  }, [imageRenderSize, transformState]);

  const transformConfig = useMemo(() => {
    if (!selectedImage || !imageRenderSize.scale) {
      return { minScale: 0.1, maxScale: 20 };
    }

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const scaleFor100Percent = 1 / imageRenderSize.scale;

    const minScale = (0.1 / dpr) * scaleFor100Percent;
    const maxScale = (2.0 / dpr) * scaleFor100Percent;

    return {
      minScale: Math.max(0.1, minScale),
      maxScale: Math.max(20, maxScale),
    };
  }, [selectedImage, imageRenderSize.scale]);

  const minScaleRef = useRef(transformConfig.minScale);
  const maxScaleRef = useRef(transformConfig.maxScale);

  useEffect(() => {
    minScaleRef.current = transformConfig.minScale;
    maxScaleRef.current = transformConfig.maxScale;
  }, [transformConfig.minScale, transformConfig.maxScale]);

  const getTransformBounds = useCallback((scale: number) => {
    const container = imageContainerRef.current;
    if (!container) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scaledW = cw * scale;
    const scaledH = ch * scale;

    let minX, maxX, minY, maxY;

    if (scaledW <= cw) {
      minX = maxX = (cw - scaledW) / 2;
    } else {
      minX = cw - scaledW;
      maxX = 0;
    }

    if (scaledH <= ch) {
      minY = maxY = (ch - scaledH) / 2;
    } else {
      minY = ch - scaledH;
      maxY = 0;
    }

    return { minX, maxX, minY, maxY };
  }, []);

  const clampToBounds = useCallback(
    (x: number, y: number, scale: number) => {
      const safeScale = Math.min(
        Math.max(Number.isFinite(scale) ? scale : 1, minScaleRef.current),
        maxScaleRef.current,
      );

      const bounds = getTransformBounds(safeScale);

      const safeX = Number.isFinite(x) ? x : 0;
      const safeY = Number.isFinite(y) ? y : 0;

      const newX = Math.min(Math.max(safeX, bounds.minX), bounds.maxX);
      const newY = Math.min(Math.max(safeY, bounds.minY), bounds.maxY);

      return { x: newX, y: newY, scale: safeScale };
    },
    [getTransformBounds],
  );

  const applyTransform = useCallback(
    (x: number, y: number, scale: number) => {
      transformStateRef.current = { positionX: x, positionY: y, scale };
      setTransformState({ scale, positionX: x, positionY: y });

      if (contentRef.current) {
        contentRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      }

      if (!isTransitioningRef.current) {
        if (scale > 1.01) {
          const container = imageContainerRef.current;
          if (container) {
            const cw = container.offsetWidth;
            const ch = container.offsetHeight;
            focalPointRef.current = {
              x: (cw / 2 - x) / (cw * scale),
              y: (ch / 2 - y) / (ch * scale),
            };
          }
        } else {
          focalPointRef.current = { x: 0.5, y: 0.5 };
        }
      }

      if (zoomDebounceTimeoutRef.current) clearTimeout(zoomDebounceTimeoutRef.current);
      zoomDebounceTimeoutRef.current = window.setTimeout(() => {
        handleZoomed({ scale, positionX: x, positionY: y });
      }, 100);
    },
    [handleZoomed],
  );

  const animateTransform = useCallback(
    (targetX: number, targetY: number, targetScale: number, duration: number) => {
      if (physicsFrameId.current) cancelAnimationFrame(physicsFrameId.current);

      const startX = transformStateRef.current.positionX;
      const startY = transformStateRef.current.positionY;
      const startScale = transformStateRef.current.scale;
      const boundedTarget = clampToBounds(targetX, targetY, targetScale);

      const startTime = performance.now();

      const step = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        const currX = startX + (boundedTarget.x - startX) * easeProgress;
        const currY = startY + (boundedTarget.y - startY) * easeProgress;
        const currScale = startScale + (boundedTarget.scale - startScale) * easeProgress;

        applyTransform(currX, currY, currScale);

        if (progress < 1) {
          animationFrameId.current = requestAnimationFrame(step);
        }
      };

      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = requestAnimationFrame(step);
    },
    [applyTransform, clampToBounds],
  );

  const startPhysicsLoop = useCallback(
    (initialVx: number, initialVy: number) => {
      if (physicsFrameId.current) cancelAnimationFrame(physicsFrameId.current);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);

      let vx = initialVx;
      let vy = initialVy;
      let lastTime = performance.now();

      const step = (time: number) => {
        const dt = Math.min(time - lastTime, 32);
        lastTime = time;

        const { scale } = transformStateRef.current;
        let { positionX: x, positionY: y } = transformStateRef.current;
        const bounds = getTransformBounds(scale);

        x += vx * dt;
        y += vy * dt;

        const decay = Math.pow(0.994, dt);
        vx *= decay;
        vy *= decay;

        let outOfBounds = false;
        if (x > bounds.maxX || x < bounds.minX || y > bounds.maxY || y < bounds.minY) {
          outOfBounds = true;
        }

        if (outOfBounds) {
          vx *= 0.5;
          vy *= 0.5;

          const correction = 0.15;
          if (x > bounds.maxX) x += (bounds.maxX - x) * correction;
          else if (x < bounds.minX) x += (bounds.minX - x) * correction;

          if (y > bounds.maxY) y += (bounds.maxY - y) * correction;
          else if (y < bounds.minY) y += (bounds.minY - y) * correction;
        }

        applyTransform(x, y, scale);

        const speed = Math.hypot(vx, vy);

        if (speed < 0.02 && !outOfBounds) {
          const finalPos = clampToBounds(x, y, scale);
          if (Math.abs(x - finalPos.x) > 0.05 || Math.abs(y - finalPos.y) > 0.05) {
            applyTransform(finalPos.x, finalPos.y, scale);
          }
          return;
        }

        if (outOfBounds && speed < 0.05 && Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
          const dist = Math.max(
            x > bounds.maxX ? x - bounds.maxX : x < bounds.minX ? bounds.minX - x : 0,
            y > bounds.maxY ? y - bounds.maxY : y < bounds.minY ? bounds.minY - y : 0,
          );
          if (dist < 0.5) {
            const finalPos = clampToBounds(x, y, scale);
            applyTransform(finalPos.x, finalPos.y, scale);
            return;
          }
        }

        physicsFrameId.current = requestAnimationFrame(step);
      };
      physicsFrameId.current = requestAnimationFrame(step);
    },
    [applyTransform, getTransformBounds, clampToBounds],
  );

  const zoomToCenter = useCallback(
    (newScale: number, duration: number) => {
      const container = imageContainerRef.current;
      if (!container) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const centerX = cw / 2;
      const centerY = ch / 2;

      const ratio = newScale / transformStateRef.current.scale;
      const newX = centerX - (centerX - transformStateRef.current.positionX) * ratio;
      const newY = centerY - (centerY - transformStateRef.current.positionY) * ratio;

      if (duration > 0) {
        animateTransform(newX, newY, newScale, duration);
      } else {
        const bounded = clampToBounds(newX, newY, newScale);
        applyTransform(bounded.x, bounded.y, bounded.scale);
      }
    },
    [animateTransform, applyTransform, clampToBounds],
  );

  useImperativeHandle(
    transformWrapperRef,
    () => ({
      zoomIn: (factor: number, time?: number) => {
        zoomToCenter(transformStateRef.current.scale * Math.exp(factor), time || 0);
      },
      zoomOut: (factor: number, time?: number) => {
        zoomToCenter(transformStateRef.current.scale * Math.exp(-factor), time || 0);
      },
      resetTransform: (time?: number) => {
        if (time) animateTransform(0, 0, 1, time);
        else applyTransform(0, 0, 1);
      },
      setTransform: (x: number, y: number, scale: number, time?: number) => {
        if (time && time > 0) animateTransform(x, y, scale, time);
        else {
          const bounded = clampToBounds(x, y, scale);
          applyTransform(bounded.x, bounded.y, bounded.scale);
        }
      },
      instance: {
        wrapperComponent: imageContainerRef.current,
        contentComponent: contentRef.current,
        get transformState() {
          return transformStateRef.current;
        },
      },
    }),
    [animateTransform, applyTransform, clampToBounds, zoomToCenter],
  );

  useEffect(() => {
    if (!transformWrapperRef.current || !targetZoom || targetZoom <= 0) return;

    const currentScale = transformStateRef.current.scale || 1;
    if (Math.abs(currentScale - targetZoom) < 0.001) return;

    const animationTime = 200;
    if (targetZoom > currentScale) {
      transformWrapperRef.current.zoomIn(Math.log(targetZoom / currentScale), animationTime);
    } else {
      transformWrapperRef.current.zoomOut(Math.log(currentScale / targetZoom), animationTime);
    }
  }, [targetZoom, transformWrapperRef]);

  const activeSubMask = useMemo(() => {
    if (isMasking && activeMaskId) {
      const container = adjustments.masks.find((c: MaskContainer) =>
        c.subMasks.some((sm: SubMask) => sm.id === activeMaskId),
      );
      return container?.subMasks.find((sm) => sm.id === activeMaskId);
    }
    if (isAiEditing && activeAiSubMaskId) {
      const container = adjustments.aiPatches.find((c: AiPatch) =>
        c.subMasks.some((sm: SubMask) => sm.id === activeAiSubMaskId),
      );
      return container?.subMasks.find((sm: SubMask) => sm.id === activeAiSubMaskId);
    }
    return null;
  }, [adjustments.masks, adjustments.aiPatches, activeMaskId, activeAiSubMaskId, isMasking, isAiEditing]);
  const activeSubMaskParameters = useMemo(
    () => toMaskParameterRecord(activeSubMask?.parameters),
    [activeSubMask?.parameters],
  );

  const isPanningDisabled =
    isMaskHovered ||
    isMaskTouchInteracting ||
    isCropping ||
    (isMasking &&
      (activeSubMask?.type === Mask.Brush ||
        activeSubMask?.type === Mask.Flow ||
        activeSubMask?.type === Mask.AiSubject ||
        activeSubMask?.type === Mask.Color ||
        activeSubMask?.type === Mask.Luminance ||
        activeSubMaskParameters['isInitialDraw'] === true)) ||
    (isAiEditing &&
      (activeSubMask?.type === Mask.Brush ||
        activeSubMask?.type === Mask.Flow ||
        activeSubMask?.type === Mask.AiSubject ||
        activeSubMask?.type === Mask.QuickEraser ||
        activeSubMask?.type === Mask.Color ||
        activeSubMask?.type === Mask.Luminance ||
        activeSubMaskParameters['isInitialDraw'] === true)) ||
    isWbPickerActive;

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (physicsFrameId.current) cancelAnimationFrame(physicsFrameId.current);

      const isPinch = e.ctrlKey;

      const isTrackpad = appSettings?.canvasInputMode === 'trackpad';
      let zoomSpeedMult = appSettings?.zoomSpeedMultiplier ?? 1.0;

      if (isTrackpad) {
        zoomSpeedMult *= 5;
      }

      const isZoomIntent = isPinch || (!isTrackpad && !e.shiftKey && !e.altKey);

      if (isZoomIntent) {
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        const zoomSensitivity = 0.002 * zoomSpeedMult;
        const exponent = delta * zoomSensitivity;

        let newScale = transformStateRef.current.scale * Math.exp(-exponent);
        newScale = Math.max(minScaleRef.current, Math.min(maxScaleRef.current, newScale));

        const ratio = newScale / transformStateRef.current.scale;
        const newX = mouseX - (mouseX - transformStateRef.current.positionX) * ratio;
        const newY = mouseY - (mouseY - transformStateRef.current.positionY) * ratio;

        const bounded = clampToBounds(newX, newY, newScale);
        applyTransform(bounded.x, bounded.y, bounded.scale);
      } else {
        if (transformStateRef.current.scale <= 1.01) return;

        const { positionX: curX, positionY: curY, scale } = transformStateRef.current;
        const bounds = getTransformBounds(scale);

        let dx = e.deltaX;
        let dy = e.deltaY;

        if (!isTrackpad) {
          if (e.shiftKey && e.altKey) {
            dx = e.deltaY !== 0 ? e.deltaY : e.deltaX;
            dy = dx;
          } else if (e.shiftKey) {
            dx = e.deltaY !== 0 ? e.deltaY : e.deltaX;
            dy = 0;
          } else if (e.altKey) {
            dx = 0;
            dy = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          }
        }

        let newX = curX - dx;
        let newY = curY - dy;

        const resistance = 0.5;

        if (newX > bounds.maxX) newX = bounds.maxX + (newX - bounds.maxX) * resistance;
        else if (newX < bounds.minX) newX = bounds.minX + (newX - bounds.minX) * resistance;

        if (newY > bounds.maxY) newY = bounds.maxY + (newY - bounds.maxY) * resistance;
        else if (newY < bounds.minY) newY = bounds.minY + (newY - bounds.minY) * resistance;

        applyTransform(newX, newY, scale);

        if (wheelSnapTimeout.current) clearTimeout(wheelSnapTimeout.current);
        wheelSnapTimeout.current = window.setTimeout(() => {
          startPhysicsLoop(0, 0);
        }, 150);
      }
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleNativeWheel);
    };
  }, [
    applyTransform,
    clampToBounds,
    getTransformBounds,
    startPhysicsLoop,
    appSettings?.canvasInputMode,
    appSettings?.zoomSpeedMultiplier,
  ]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      wasPanningDisabledOnDown.current = isPanningDisabled;

      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;

      const isMiddleClick = e.pointerType === 'mouse' && e.button === 1;

      if (isPanningDisabled && !isMiddleClick) return;

      if (isMiddleClick) {
        isMiddleMousePanning.current = true;
        setIsMiddleMousePanningState(true);
      }

      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (physicsFrameId.current) cancelAnimationFrame(physicsFrameId.current);

      panVelocityHistory.current = [];
      mouseDownPos.current = { x: e.clientX, y: e.clientY };
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.current.size === 1) {
        lastPanPos.current = { x: e.clientX, y: e.clientY };
        setIsPanningState(true);
      } else if (activePointers.current.size === 2) {
        const pts = Array.from(activePointers.current.values());
        const [firstPointer, secondPointer] = pts;
        if (!firstPointer || !secondPointer) return;
        lastPinch.current = {
          dist: Math.hypot(firstPointer.x - secondPointer.x, firstPointer.y - secondPointer.y),
          midX: (firstPointer.x + secondPointer.x) / 2,
          midY: (firstPointer.y + secondPointer.y) / 2,
        };
      }

      if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isPanningDisabled],
  );

  useEffect(() => {
    if (!isPanningDisabled) return;
    if (isMiddleMousePanning.current) return;

    activePointers.current.clear();
    lastPanPos.current = null;
    lastPinch.current = null;
    panVelocityHistory.current = [];
    mouseDownPos.current = null;
    setIsPanningState(false);
    setIsMiddleMousePanningState(false);
  }, [isPanningDisabled]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!activePointers.current.has(e.pointerId)) return;
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const canPan = !isPanningDisabled || isMiddleMousePanning.current;

      if (activePointers.current.size === 1 && lastPanPos.current && isPanningState && canPan) {
        panVelocityHistory.current.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (panVelocityHistory.current.length > 6) panVelocityHistory.current.shift();

        let dx = e.clientX - lastPanPos.current.x;
        let dy = e.clientY - lastPanPos.current.y;
        lastPanPos.current = { x: e.clientX, y: e.clientY };

        const bounds = getTransformBounds(transformStateRef.current.scale);
        const curX = transformStateRef.current.positionX;
        const curY = transformStateRef.current.positionY;

        if (curX < bounds.minX && dx < 0) dx *= 0.35;
        if (curX > bounds.maxX && dx > 0) dx *= 0.35;
        if (curY < bounds.minY && dy < 0) dy *= 0.35;
        if (curY > bounds.maxY && dy > 0) dy *= 0.35;

        applyTransform(curX + dx, curY + dy, transformStateRef.current.scale);
      } else if (activePointers.current.size === 2 && lastPinch.current) {
        const pts = Array.from(activePointers.current.values());
        const [firstPointer, secondPointer] = pts;
        if (!firstPointer || !secondPointer) return;
        const dist = Math.hypot(firstPointer.x - secondPointer.x, firstPointer.y - secondPointer.y);
        const midX = (firstPointer.x + secondPointer.x) / 2;
        const midY = (firstPointer.y + secondPointer.y) / 2;

        const distDelta = dist / lastPinch.current.dist;
        let newScale = transformStateRef.current.scale * distDelta;
        newScale = Math.max(minScaleRef.current, Math.min(maxScaleRef.current, newScale));

        const rect = imageContainerRef.current?.getBoundingClientRect();
        if (rect) {
          const mouseX = midX - rect.left;
          const mouseY = midY - rect.top;
          const ratio = newScale / transformStateRef.current.scale;

          const panX = midX - lastPinch.current.midX;
          const panY = midY - lastPinch.current.midY;

          const newX = mouseX - (mouseX - transformStateRef.current.positionX) * ratio + panX;
          const newY = mouseY - (mouseY - transformStateRef.current.positionY) * ratio + panY;

          const bounded = clampToBounds(newX, newY, newScale);
          applyTransform(bounded.x, bounded.y, bounded.scale);
        }

        lastPinch.current = { dist, midX, midY };
      }
    },
    [applyTransform, clampToBounds, getTransformBounds, isPanningDisabled, isPanningState],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      activePointers.current.delete(e.pointerId);

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      if (activePointers.current.size === 1) {
        const pts = Array.from(activePointers.current.values());
        const pointer = pts[0];
        if (!pointer) return;
        lastPanPos.current = { x: pointer.x, y: pointer.y };
        lastPinch.current = null;
      } else if (activePointers.current.size === 0) {
        lastPanPos.current = null;
        lastPinch.current = null;
        setIsPanningState(false);
        isMiddleMousePanning.current = false;
        setIsMiddleMousePanningState(false);

        let vx = 0,
          vy = 0;
        const history = panVelocityHistory.current;
        if (history.length > 1) {
          const first = history[0];
          const last = history[history.length - 1];
          if (!first || !last) return;
          const dt = last.t - first.t;
          if (dt > 0 && performance.now() - last.t < 50) {
            vx = (last.x - first.x) / dt;
            vy = (last.y - first.y) / dt;
          }
        }

        const { positionX, positionY, scale } = transformStateRef.current;
        const bounds = getTransformBounds(scale);
        const outOfBounds =
          positionX > bounds.maxX || positionX < bounds.minX || positionY > bounds.maxY || positionY < bounds.minY;

        if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05 || outOfBounds) {
          startPhysicsLoop(vx, vy);
        }
      }
    },
    [getTransformBounds, startPhysicsLoop],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (isPanningDisabled || wasPanningDisabledOnDown.current) return;

      if (mouseDownPos.current) {
        const dx = Math.abs(e.clientX - mouseDownPos.current.x);
        const dy = Math.abs(e.clientY - mouseDownPos.current.y);
        if (dx > 5 || dy > 5) return;
      }

      const currentScale = transformStateRef.current.scale;

      if (isClickAnimating.current || currentScale > 1.01) {
        if (!isClickAnimating.current && currentScale > 1.01) {
          savedZoomState.current = {
            scale: currentScale,
            positionX: transformStateRef.current.positionX,
            positionY: transformStateRef.current.positionY,
          };
        }
        animateTransform(0, 0, 1, clickAnimationTime);
        isClickAnimating.current = false;
      } else {
        isClickAnimating.current = true;
        setTimeout(() => {
          isClickAnimating.current = false;
        }, clickAnimationTime + 50);

        const container = imageContainerRef.current;
        if (!container) return;

        const currentPositionX = transformStateRef.current.positionX;
        const currentPositionY = transformStateRef.current.positionY;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomTarget = savedZoomState.current
          ? savedZoomState.current.scale
          : Math.min(currentScale * 2, maxScaleRef.current);
        const ratio = zoomTarget / currentScale;

        const newPositionX = mouseX - (mouseX - currentPositionX) * ratio;
        const newPositionY = mouseY - (mouseY - currentPositionY) * ratio;

        animateTransform(newPositionX, newPositionY, zoomTarget, clickAnimationTime);
      }
    },
    [animateTransform, isPanningDisabled],
  );

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (!showOriginal) return;

    const syncTimer = setTimeout(() => {
      setEditor({ showOriginal: false });
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [adjustments, setEditor, showOriginal]);

  useEffect(() => {
    if (isMasking || isAiEditing) return;

    const syncTimer = setTimeout(() => {
      setIsMaskTouchInteracting(false);
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [isMasking, isAiEditing]);

  const hasDisplayableImage = finalPreviewUrl || selectedImage?.thumbnailUrl;
  const showSpinner = isLoading && !hasDisplayableImage;

  useLayoutEffect(() => {
    const container = imageContainerRef.current;
    if (!container || imageRenderSize.width === 0) return;

    const currentRect = container.getBoundingClientRect();
    const scaleOld = transformStateRef.current.scale;
    const posOldX = transformStateRef.current.positionX;
    const posOldY = transformStateRef.current.positionY;

    if (isInstantTransition && !transitionAnchorRef.current && scaleOld > 1.01) {
      transitionAnchorRef.current = {
        active: true,
        screenImageLeft: prevRenderState.current.containerLeft + posOldX + prevRenderState.current.offsetX * scaleOld,
        screenImageTop: prevRenderState.current.containerTop + posOldY + prevRenderState.current.offsetY * scaleOld,
        physicalImageWidth: prevRenderState.current.width * scaleOld,
      };
    }

    if (!isInstantTransition && transitionAnchorRef.current) {
      transitionAnchorRef.current = null;
    }

    if (transitionAnchorRef.current && transitionAnchorRef.current.active) {
      const anchor = transitionAnchorRef.current;

      const scaleNew = anchor.physicalImageWidth / imageRenderSize.width;

      const posNewX = anchor.screenImageLeft - currentRect.left - imageRenderSize.offsetX * scaleNew;
      const posNewY = anchor.screenImageTop - currentRect.top - imageRenderSize.offsetY * scaleNew;

      if (
        Math.abs(scaleNew - scaleOld) > 0.001 ||
        Math.abs(posNewX - posOldX) > 0.5 ||
        Math.abs(posNewY - posOldY) > 0.5
      ) {
        applyTransform(posNewX, posNewY, scaleNew);
      }
    }

    prevRenderState.current = {
      containerLeft: currentRect.left,
      containerTop: currentRect.top,
      offsetX: imageRenderSize.offsetX,
      offsetY: imageRenderSize.offsetY,
      width: imageRenderSize.width,
    };
  }, [isFullScreen, imageRenderSize, isInstantTransition, applyTransform]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (imageRenderSize.width > 0) {
        const currentDisplaySize = {
          width: imageRenderSize.width * transformState.scale,
          height: imageRenderSize.height * transformState.scale,
          scale: transformState.scale,
          offsetX: imageRenderSize.offsetX,
          offsetY: imageRenderSize.offsetY,
          containerWidth: imageContainerRef.current?.clientWidth || 0,
          containerHeight: imageContainerRef.current?.clientHeight || 0,
        };
        handleDisplaySizeChange(currentDisplaySize);
      }
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, [imageRenderSize, transformState.scale, handleDisplaySizeChange]);

  const processOverlayQueue = useCallback(async () => {
    if (isGeneratingOverlayRef.current || !pendingOverlayRequestRef.current) return;

    const { maskDef, renderSize, jsAdjustments } = pendingOverlayRequestRef.current;
    pendingOverlayRequestRef.current = null;

    if (!maskDef.visible || renderSize.width === 0) {
      setMaskOverlayUrl(null);
      return;
    }

    isGeneratingOverlayRef.current = true;
    try {
      const cropOffset = [jsAdjustments.crop?.x || 0, jsAdjustments.crop?.y || 0];

      const { maskOverlaySettings, patchesSentToBackend } = useEditorStore.getState();
      const normalizedOverlaySettings = normalizeMaskOverlaySettings(maskOverlaySettings);
      if (normalizedOverlaySettings.mode === 'hidden') {
        setMaskOverlayUrl(null);
        return;
      }

      const stripSubMasks = (subMasks?: Array<SubMask>) => {
        if (!Array.isArray(subMasks)) return;
        subMasks.forEach((sm) => {
          if (sm.id && sm.parameters && patchesSentToBackend.has(sm.id)) {
            const parameters = toMaskParameterRecord(sm.parameters);
            if (parameters['mask_data_base64'] !== undefined) parameters['mask_data_base64'] = null;
            if (parameters['maskDataBase64'] !== undefined) parameters['maskDataBase64'] = null;
            sm.parameters = parameters;
          }
        });
      };

      const strippedAdjustments = structuredClone(jsAdjustments);
      strippedAdjustments.masks.forEach((m) => {
        stripSubMasks(m.subMasks);
      });
      strippedAdjustments.aiPatches.forEach((p) => {
        stripSubMasks(p.subMasks);
      });

      const strippedMaskDef = structuredClone(maskDef);
      stripSubMasks(strippedMaskDef.subMasks);

      const dataUrl: string = await invoke(Invokes.GenerateMaskOverlay, {
        cropOffset,
        height: Math.round(renderSize.height),
        maskDef: strippedMaskDef,
        overlaySettings: normalizedOverlaySettings,
        scale: renderSize.scale,
        width: Math.round(renderSize.width),
        jsAdjustments: strippedAdjustments,
      });

      if (dataUrl) {
        setMaskOverlayUrl(dataUrl);
      } else {
        setMaskOverlayUrl(null);
      }
    } catch (e) {
      console.error('Failed to generate live mask overlay:', e);
      setMaskOverlayUrl(null);
    } finally {
      isGeneratingOverlayRef.current = false;
      requestAnimationFrame(() => {
        if (pendingOverlayRequestRef.current) {
          void processOverlayQueueRef.current();
        }
      });
    }
  }, []);
  useLayoutEffect(() => {
    processOverlayQueueRef.current = processOverlayQueue;
  }, [processOverlayQueue]);

  const requestMaskOverlay = useCallback(
    (maskDef: MaskPreviewDefinition, renderSize: RenderSize, currentAdjustments: Adjustments) => {
      pendingOverlayRequestRef.current = { maskDef, renderSize, jsAdjustments: currentAdjustments };
      void processOverlayQueue();
    },
    [processOverlayQueue],
  );

  const handleLiveMaskPreview = useCallback(
    (maskDef: MaskContainer | AiPatch) => {
      const normalizedDef: MaskPreviewDefinition =
        'adjustments' in maskDef
          ? maskDef
          : {
              ...maskDef,
              adjustments: {},
              opacity: 100,
            };
      requestMaskOverlay(normalizedDef, imageRenderSize, adjustments);
    },
    [imageRenderSize, adjustments, requestMaskOverlay],
  );

  const croppedDimensionsRef = useRef(croppedDimensions);
  useEffect(() => {
    croppedDimensionsRef.current = croppedDimensions;
  }, [croppedDimensions]);

  const wgpuStateRef = useRef<WgpuRenderState>({
    useWgpuRenderer: appSettings?.useWgpuRenderer,
    isReady: selectedImage?.isReady ?? false,
    hasRenderedFirstFrame,
    isCropping,
    uncroppedAdjustedPreviewUrl,
    showOriginal,
    bgPrimary: [24 / 255, 24 / 255, 24 / 255, 1.0],
    bgSecondary: [35 / 255, 35 / 255, 35 / 255, 1.0],
  });

  useEffect(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const bgPrimaryStr = rootStyle.getPropertyValue('--app-bg-primary') || 'rgb(24, 24, 24)';
    const bgSecondaryStr = rootStyle.getPropertyValue('--app-bg-secondary') || 'rgb(35, 35, 35)';

    wgpuStateRef.current = {
      useWgpuRenderer: appSettings?.useWgpuRenderer,
      isReady: selectedImage?.isReady ?? false,
      hasRenderedFirstFrame,
      isCropping,
      uncroppedAdjustedPreviewUrl,
      showOriginal,
      bgPrimary: parseRgb(bgPrimaryStr),
      bgSecondary: parseRgb(bgSecondaryStr),
    };
  }, [
    appSettings?.useWgpuRenderer,
    selectedImage?.isReady,
    hasRenderedFirstFrame,
    isCropping,
    uncroppedAdjustedPreviewUrl,
    showOriginal,
    appSettings?.theme,
    finalPreviewUrl,
  ]);

  useEffect(() => {
    let isEffectActive = true;
    let isInvoking = false;

    const syncWgpu = () => {
      if (!isEffectActive) return;

      const state = wgpuStateRef.current;
      const container = imageContainerRef.current;

      if (!container) {
        wgpuSyncRef.current = requestAnimationFrame(syncWgpu);
        return;
      }

      const currentRect = container.getBoundingClientRect();

      if (currentRect.width < 10 || currentRect.height < 10) {
        wgpuSyncRef.current = requestAnimationFrame(syncWgpu);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const windowWidth = Math.max(window.innerWidth * dpr, 1);
      const windowHeight = Math.max(window.innerHeight * dpr, 1);

      const OVERLAP = 2;
      const clipX = (currentRect.left - OVERLAP) * dpr;
      const clipY = (currentRect.top - OVERLAP) * dpr;
      const clipW = Math.max((currentRect.width + OVERLAP * 2) * dpr, 1);
      const clipH = Math.max((currentRect.height + OVERLAP * 2) * dpr, 1);

      if (state.useWgpuRenderer === false || !state.isReady || !state.hasRenderedFirstFrame) {
        const hiddenTransform = `${windowWidth},${windowHeight},-999999,-999999,1,1,${clipX},${clipY},${clipW},${clipH},${state.bgPrimary.join(',')},${state.bgSecondary.join(',')}`;

        if (lastWgpuTransformRef.current !== hiddenTransform && !isInvoking) {
          lastWgpuTransformRef.current = hiddenTransform;
          isInvoking = true;
          invoke(Invokes.UpdateWgpuTransform, {
            payload: {
              windowWidth,
              windowHeight,
              x: -999999,
              y: -999999,
              width: 1,
              height: 1,
              clipX,
              clipY,
              clipWidth: clipW,
              clipHeight: clipH,
              bgPrimary: state.bgPrimary,
              bgSecondary: state.bgSecondary,
              pixelated: false,
            },
          })
            .catch(() => {})
            .finally(() => {
              isInvoking = false;
            });
        }
        wgpuSyncRef.current = requestAnimationFrame(syncWgpu);
        return;
      }

      const scale = transformStateRef.current.scale;
      const posX = transformStateRef.current.positionX;
      const posY = transformStateRef.current.positionY;

      const cw = currentRect.width;
      const ch = currentRect.height;

      const irs = imageRenderSizeRef.current;
      const offsetX = irs.width > 0 ? irs.offsetX : 0;
      const offsetY = irs.height > 0 ? irs.offsetY : 0;
      const baseW = irs.width > 0 ? irs.width : cw;
      const baseH = irs.height > 0 ? irs.height : ch;

      let screenX = (currentRect.left + posX + offsetX * scale) * dpr || 0;
      let screenY = (currentRect.top + posY + offsetY * scale) * dpr || 0;
      let screenW = baseW * scale * dpr || 1;
      let screenH = baseH * scale * dpr || 1;

      const isCropViewVisible = state.isCropping && state.uncroppedAdjustedPreviewUrl;

      if (isCropViewVisible) {
        screenX = -999999;
        screenY = -999999;
        screenW = 1;
        screenH = 1;
      } else {
        screenW = Math.max(screenW, 1);
        screenH = Math.max(screenH, 1);
      }

      const currentTransform = `${windowWidth},${windowHeight},${screenX},${screenY},${screenW},${screenH},${clipX},${clipY},${clipW},${clipH},${state.bgPrimary.join(',')},${state.bgSecondary.join(',')}`;

      if (lastWgpuTransformRef.current !== currentTransform && !isInvoking) {
        lastWgpuTransformRef.current = currentTransform;
        isInvoking = true;

        const isZoomedIn = scale >= maxScaleRef.current - 0.5;

        invoke(Invokes.UpdateWgpuTransform, {
          payload: {
            windowWidth,
            windowHeight,
            x: screenX,
            y: screenY,
            width: screenW,
            height: screenH,
            clipX,
            clipY,
            clipWidth: clipW,
            clipHeight: clipH,
            bgPrimary: state.bgPrimary,
            bgSecondary: state.bgSecondary,
            pixelated: isZoomedIn,
          },
        })
          .catch((err: unknown) => {
            console.warn('WGPU Sync Error:', err);
          })
          .finally(() => {
            isInvoking = false;
          });
      }

      wgpuSyncRef.current = requestAnimationFrame(syncWgpu);
    };

    wgpuSyncRef.current = requestAnimationFrame(syncWgpu);

    return () => {
      isEffectActive = false;
      if (wgpuSyncRef.current !== null) {
        cancelAnimationFrame(wgpuSyncRef.current);
      }
    };
  }, []);

  const overlayTriggerHash = useMemo(() => {
    let activeMaskDef: MaskContainer | AiPatch | undefined;
    if (activeRightPanel === Panel.Masks && activeMaskContainerId) {
      activeMaskDef = adjustments.masks.find((c: MaskContainer) => c.id === activeMaskContainerId);
    } else if (activeRightPanel === Panel.Ai && activeAiPatchContainerId) {
      activeMaskDef = adjustments.aiPatches.find((p: AiPatch) => p.id === activeAiPatchContainerId);
    }

    if (!activeMaskDef) return null;

    const geometryKeys = [
      'crop',
      'rotation',
      'flipHorizontal',
      'flipVertical',
      'orientationSteps',
      'transformDistortion',
      'transformVertical',
      'transformHorizontal',
      'transformRotate',
      'transformAspect',
      'transformScale',
      'transformXOffset',
      'transformYOffset',
      'lensDistortionAmount',
      'lensVignetteAmount',
      'lensTcaAmount',
      'lensDistortionParams',
      'lensMaker',
      'lensModel',
      'lensDistortionEnabled',
      'lensTcaEnabled',
      'lensVignetteEnabled',
    ];

    const geometry: Record<string, unknown> = {};
    geometryKeys.forEach((k) => {
      geometry[k] = adjustments[k];
    });

    const subMasks = activeMaskDef.subMasks.map((sm: SubMask) => {
      const rest: Omit<SubMask, 'parameters'> = {
        id: sm.id,
        invert: sm.invert,
        mode: sm.mode,
        opacity: sm.opacity,
        type: sm.type,
        visible: sm.visible,
        ...(sm.name !== undefined ? { name: sm.name } : {}),
      };
      const cleanParams: SerializableMaskParameters = toMaskParameterRecord(sm.parameters);
      const maskDataBase64 = cleanParams.mask_data_base64;
      const maskDataCamelBase64 = cleanParams.maskDataBase64;
      const maskDataFingerprint =
        typeof maskDataBase64 === 'string' ? `${maskDataBase64.length}-${maskDataBase64.slice(-20)}` : null;
      const maskDataCamelFingerprint =
        typeof maskDataCamelBase64 === 'string'
          ? `${maskDataCamelBase64.length}-${maskDataCamelBase64.slice(-20)}`
          : null;
      delete cleanParams.mask_data_base64;
      delete cleanParams.maskDataBase64;
      return {
        ...rest,
        parameters: cleanParams,
        _maskDataFingerprint: maskDataFingerprint,
        _maskDataCamelFingerprint: maskDataCamelFingerprint,
      };
    });

    return JSON.stringify({
      id: activeMaskDef.id,
      invert: activeMaskDef.invert,
      opacity: 'opacity' in activeMaskDef ? activeMaskDef.opacity : 100,
      subMasks,
      geometry,
      maskOverlaySettings: normalizeMaskOverlaySettings(maskOverlaySettings),
      renderSize: { w: imageRenderSize.width, h: imageRenderSize.height },
    });
  }, [
    activeRightPanel,
    activeMaskContainerId,
    activeAiPatchContainerId,
    adjustments,
    maskOverlaySettings,
    imageRenderSize.width,
    imageRenderSize.height,
  ]);

  useEffect(() => {
    let maskDefForOverlay: MaskPreviewDefinition | null = null;

    if (activeRightPanel === Panel.Masks && activeMaskContainerId) {
      const activeMask = adjustments.masks.find((c: MaskContainer) => c.id === activeMaskContainerId);
      if (activeMask) {
        maskDefForOverlay = {
          ...activeMask,
          adjustments: {},
        };
      }
    } else if (activeRightPanel === Panel.Ai && activeAiPatchContainerId) {
      const activePatch = adjustments.aiPatches.find((p: AiPatch) => p.id === activeAiPatchContainerId);
      if (activePatch) {
        maskDefForOverlay = {
          ...activePatch,
          adjustments: {},
          opacity: 100,
        };
      }
    }

    if (!maskDefForOverlay) return;
    const frame = requestAnimationFrame(() => {
      requestMaskOverlay(maskDefForOverlay, imageRenderSize, adjustments);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    overlayTriggerHash,
    requestMaskOverlay,
    activeRightPanel,
    activeMaskContainerId,
    activeAiPatchContainerId,
    imageRenderSize,
    adjustments,
  ]);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setIsLoaderVisible(showSpinner);
      },
      showSpinner ? 0 : 300,
    );

    return () => {
      clearTimeout(timer);
    };
  }, [showSpinner]);

  useEffect(() => {
    if (!isCropping || !selectedImage?.width) {
      return;
    }

    const cropTimer = setTimeout(() => {
      const { aspectRatio, orientationSteps, crop: currentAdjCrop, rotation } = adjustments;
      const effectiveRotation = liveRotation !== null ? liveRotation : rotation;

      const geometryChanged =
        prevCropParams.current?.rotation !== rotation ||
        prevCropParams.current.aspectRatio !== aspectRatio ||
        prevCropParams.current.orientationSteps !== orientationSteps;

      const isDraggingRotation = liveRotation !== null;
      const needsRecalc = currentAdjCrop === null || geometryChanged || isDraggingRotation;

      if (needsRecalc) {
        const isSwapped = orientationSteps === 1 || orientationSteps === 3;
        const W = isSwapped ? selectedImage.height : selectedImage.width;
        const H = isSwapped ? selectedImage.width : selectedImage.height;
        const A = aspectRatio || W / H;

        let nextPixelCrop = currentAdjCrop;
        const aspectChanged = prevCropParams.current?.aspectRatio !== aspectRatio;
        const orientationChanged = prevCropParams.current?.orientationSteps !== orientationSteps;
        const rotationChanged = prevCropParams.current?.rotation !== rotation || isDraggingRotation;

        let isMaximized = false;
        if (currentAdjCrop) {
          const referenceRotation = prevCropParams.current?.rotation ?? rotation;
          const maxCropForReference = calculateCenteredCrop(
            selectedImage.width,
            selectedImage.height,
            orientationSteps,
            A,
            referenceRotation,
          );

          if (
            maxCropForReference &&
            Math.abs(currentAdjCrop.x - maxCropForReference.x) <= 2 &&
            Math.abs(currentAdjCrop.y - maxCropForReference.y) <= 2 &&
            Math.abs(currentAdjCrop.width - maxCropForReference.width) <= 2 &&
            Math.abs(currentAdjCrop.height - maxCropForReference.height) <= 2
          ) {
            isMaximized = true;
          }
        }

        if (!currentAdjCrop || orientationChanged) {
          nextPixelCrop = calculateCenteredCrop(
            selectedImage.width,
            selectedImage.height,
            orientationSteps,
            A,
            effectiveRotation,
          );
        } else if (aspectChanged) {
          if (!aspectRatio) {
            nextPixelCrop = currentAdjCrop;
          } else {
            const curW = currentAdjCrop.width;
            const curH = currentAdjCrop.height;
            const curCx = currentAdjCrop.x + curW / 2;
            const curCy = currentAdjCrop.y + curH / 2;

            let newW = curW;
            let newH = curW / A;

            if (newH > curH) {
              newH = curH;
              newW = curH * A;
            }

            nextPixelCrop = {
              unit: 'px',
              x: Math.ceil(curCx - newW / 2),
              y: Math.ceil(curCy - newH / 2),
              width: Math.floor(newW),
              height: Math.floor(newH),
            };
          }

          if (!checkCropValid(nextPixelCrop, W, H, effectiveRotation)) {
            nextPixelCrop = calculateCenteredCrop(
              selectedImage.width,
              selectedImage.height,
              orientationSteps,
              A,
              effectiveRotation,
            );
          }
        } else if (isMaximized && rotationChanged) {
          nextPixelCrop = calculateCenteredCrop(
            selectedImage.width,
            selectedImage.height,
            orientationSteps,
            A,
            effectiveRotation,
          );
        } else {
          if (!checkCropValid(currentAdjCrop, W, H, effectiveRotation)) {
            let low = 0.1;
            let high = 1.0;
            let bestCrop = currentAdjCrop;

            for (let i = 0; i < 10; i++) {
              const mid = (low + high) / 2;
              const cx = currentAdjCrop.x + currentAdjCrop.width / 2;
              const cy = currentAdjCrop.y + currentAdjCrop.height / 2;
              const nw = currentAdjCrop.width * mid;
              const nh = currentAdjCrop.height * mid;
              const testCrop = {
                unit: 'px' as const,
                x: cx - nw / 2,
                y: cy - nh / 2,
                width: nw,
                height: nh,
              };

              if (checkCropValid(testCrop, W, H, effectiveRotation)) {
                bestCrop = testCrop;
                low = mid;
              } else {
                high = mid;
              }
            }

            if (low < 0.15) {
              nextPixelCrop = calculateCenteredCrop(
                selectedImage.width,
                selectedImage.height,
                orientationSteps,
                A,
                effectiveRotation,
              );
            } else {
              nextPixelCrop = {
                unit: 'px',
                x: Math.ceil(bestCrop.x),
                y: Math.ceil(bestCrop.y),
                width: Math.floor(bestCrop.width),
                height: Math.floor(bestCrop.height),
              };
            }
          }
        }

        if (isDraggingRotation) {
          if (nextPixelCrop) {
            const pc: PercentCrop = {
              unit: '%',
              x: (nextPixelCrop.x / W) * 100,
              y: (nextPixelCrop.y / H) * 100,
              width: (nextPixelCrop.width / W) * 100,
              height: (nextPixelCrop.height / H) * 100,
            };
            setCrop(pc);
            lastValidCropRef.current = pc;
          }
        } else {
          prevCropParams.current = { rotation, aspectRatio, orientationSteps };

          if (
            nextPixelCrop &&
            (!currentAdjCrop ||
              Math.abs(currentAdjCrop.x - nextPixelCrop.x) > 1 ||
              Math.abs(currentAdjCrop.y - nextPixelCrop.y) > 1 ||
              Math.abs(currentAdjCrop.width - nextPixelCrop.width) > 1 ||
              Math.abs(currentAdjCrop.height - nextPixelCrop.height) > 1)
          ) {
            setAdjustments((prev: Adjustments) => ({ ...prev, crop: nextPixelCrop }));
          }
        }
      }
    }, 0);

    return () => {
      clearTimeout(cropTimer);
    };
  }, [
    adjustments.aspectRatio,
    adjustments.crop,
    adjustments.orientationSteps,
    adjustments.rotation,
    adjustments,
    liveRotation,
    isCropping,
    selectedImage,
    setAdjustments,
  ]);

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      if (!isCropping || !selectedImage?.width) {
        setCrop(null);
        return;
      }

      if (liveRotation !== null) {
        return;
      }

      const orientationSteps = adjustments.orientationSteps || 0;
      const isSwapped = orientationSteps === 1 || orientationSteps === 3;
      const cropBaseWidth = isSwapped ? selectedImage.height : selectedImage.width;
      const cropBaseHeight = isSwapped ? selectedImage.width : selectedImage.height;

      const { crop: pixelCrop } = adjustments;

      if (pixelCrop) {
        const pct: PercentCrop = {
          unit: '%',
          x: (pixelCrop.x / cropBaseWidth) * 100,
          y: (pixelCrop.y / cropBaseHeight) * 100,
          width: (pixelCrop.width / cropBaseWidth) * 100,
          height: (pixelCrop.height / cropBaseHeight) * 100,
        };
        setCrop(pct);
        lastValidCropRef.current = pct;
      }
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [isCropping, adjustments, adjustments.crop, adjustments.orientationSteps, selectedImage, liveRotation]);

  const handleCropChange = useCallback(
    (_pixelCrop: Crop, percentCrop: PercentCrop) => {
      if (!selectedImage) return;

      const orientationSteps = adjustments.orientationSteps || 0;
      const isSwapped = orientationSteps === 1 || orientationSteps === 3;
      const W = isSwapped ? selectedImage.height : selectedImage.width;
      const H = isSwapped ? selectedImage.width : selectedImage.height;
      const rotation = liveRotation !== null ? liveRotation : adjustments.rotation || 0;

      const MIN_CROP_PX = 64;
      const minPctW = (MIN_CROP_PX / W) * 100;
      const minPctH = (MIN_CROP_PX / H) * 100;

      if (percentCrop.width < minPctW || percentCrop.height < minPctH) {
        return;
      }

      const toPixel = (pc: PercentCrop): Crop => ({
        unit: 'px',
        x: (pc.x / 100) * W,
        y: (pc.y / 100) * H,
        width: (pc.width / 100) * W,
        height: (pc.height / 100) * H,
      });

      if (checkCropValid(toPixel(percentCrop), W, H, rotation)) {
        setCrop(percentCrop);
        lastValidCropRef.current = percentCrop;
        return;
      }

      if (!lastValidCropRef.current) {
        setCrop(percentCrop);
        lastValidCropRef.current = percentCrop;
        return;
      }

      if (!checkCropValid(toPixel(lastValidCropRef.current), W, H, rotation)) {
        const lv = lastValidCropRef.current;
        const cx = lv.x + lv.width / 2;
        const cy = lv.y + lv.height / 2;
        let lo = 0;
        let hi = 1;
        let healed: PercentCrop = lv;
        for (let i = 0; i < 15; i++) {
          const mid = (lo + hi) / 2;
          const factor = 1 - mid;
          const test: PercentCrop = {
            unit: '%',
            x: cx - (lv.width / 2) * factor,
            y: cy - (lv.height / 2) * factor,
            width: lv.width * factor,
            height: lv.height * factor,
          };
          if (checkCropValid(toPixel(test), W, H, rotation)) {
            healed = test;
            hi = mid;
          } else {
            lo = mid;
          }
        }
        lastValidCropRef.current = healed;
      }

      const lastValid = lastValidCropRef.current;
      const oldL = lastValid.x;
      const oldT = lastValid.y;
      const oldR = lastValid.x + lastValid.width;
      const oldB = lastValid.y + lastValid.height;
      const oldW = lastValid.width;
      const oldH = lastValid.height;

      const newL = percentCrop.x;
      const newT = percentCrop.y;
      const newR = percentCrop.x + percentCrop.width;
      const newB = percentCrop.y + percentCrop.height;
      const newW = percentCrop.width;
      const newH = percentCrop.height;

      if (Math.abs(newW - oldW) < 1e-3 && Math.abs(newH - oldH) < 1e-3) {
        let finalCrop = { ...lastValid };

        const applyAxis = (axis: 'X' | 'Y') => {
          let low = 0,
            high = 1;
          let bestValid = { ...finalCrop };

          for (let i = 0; i < 15; i++) {
            const mid = (low + high) / 2;
            const testCrop = { ...finalCrop };

            if (axis === 'X') {
              testCrop.x = finalCrop.x + (percentCrop.x - lastValid.x) * mid;
            } else {
              testCrop.y = finalCrop.y + (percentCrop.y - lastValid.y) * mid;
            }

            if (checkCropValid(toPixel(testCrop), W, H, rotation)) {
              bestValid = { ...testCrop };
              low = mid;
            } else {
              high = mid;
            }
          }
          finalCrop = bestValid;
        };

        const dx = Math.abs(percentCrop.x - lastValid.x);
        const dy = Math.abs(percentCrop.y - lastValid.y);

        if (dx > dy) {
          applyAxis('X');
          applyAxis('Y');
        } else {
          applyAxis('Y');
          applyAxis('X');
        }

        setCrop(finalCrop);
        lastValidCropRef.current = finalCrop;
        return;
      }

      const lastRatio = oldW / oldH;
      const newRatio = newW / newH;
      const isProportional = adjustments.aspectRatio || Math.abs(lastRatio - newRatio) < 0.005;

      if (isProportional) {
        const oldCX = oldL + oldW / 2;
        const oldCY = oldT + oldH / 2;
        const newCX = newL + newW / 2;
        const newCY = newT + newH / 2;

        const dTL = Math.hypot(newL - oldL, newT - oldT);
        const dTR = Math.hypot(newR - oldR, newT - oldT);
        const dBL = Math.hypot(newL - oldL, newB - oldB);
        const dBR = Math.hypot(newR - oldR, newB - oldB);
        const dTC = Math.hypot(newCX - oldCX, newT - oldT);
        const dBC = Math.hypot(newCX - oldCX, newB - oldB);
        const dLC = Math.hypot(newL - oldL, newCY - oldCY);
        const dRC = Math.hypot(newR - oldR, newCY - oldCY);
        const dC = Math.hypot(newCX - oldCX, newCY - oldCY);

        const minD = Math.min(dTL, dTR, dBL, dBR, dTC, dBC, dLC, dRC, dC);

        let targetCrop: PercentCrop = { ...percentCrop };

        if (minD === dTL) {
          targetCrop = { unit: '%', x: oldL, y: oldT, width: newW, height: newH };
        } else if (minD === dTR) {
          targetCrop = { unit: '%', x: oldR - newW, y: oldT, width: newW, height: newH };
        } else if (minD === dBL) {
          targetCrop = { unit: '%', x: oldL, y: oldB - newH, width: newW, height: newH };
        } else if (minD === dBR) {
          targetCrop = { unit: '%', x: oldR - newW, y: oldB - newH, width: newW, height: newH };
        } else if (minD === dTC) {
          targetCrop = { unit: '%', x: oldCX - newW / 2, y: oldT, width: newW, height: newH };
        } else if (minD === dBC) {
          targetCrop = { unit: '%', x: oldCX - newW / 2, y: oldB - newH, width: newW, height: newH };
        } else if (minD === dLC) {
          targetCrop = { unit: '%', x: oldL, y: oldCY - newH / 2, width: newW, height: newH };
        } else if (minD === dRC) {
          targetCrop = { unit: '%', x: oldR - newW, y: oldCY - newH / 2, width: newW, height: newH };
        } else if (minD === dC) {
          targetCrop = { unit: '%', x: oldCX - newW / 2, y: oldCY - newH / 2, width: newW, height: newH };
        }

        const isValidInitially = checkCropValid(toPixel(targetCrop), W, H, rotation);

        if (newW <= oldW && isValidInitially) {
          setCrop(targetCrop);
          lastValidCropRef.current = targetCrop;
        } else {
          let low = 0;
          let high = 1;
          let bestValid = { ...lastValid };

          for (let i = 0; i < 15; i++) {
            const mid = (low + high) / 2;
            const testCrop: PercentCrop = {
              unit: '%',
              x: oldL + (targetCrop.x - oldL) * mid,
              y: oldT + (targetCrop.y - oldT) * mid,
              width: oldW + (targetCrop.width - oldW) * mid,
              height: oldH + (targetCrop.height - oldH) * mid,
            };

            if (checkCropValid(toPixel(testCrop), W, H, rotation)) {
              bestValid = testCrop;
              low = mid;
            } else {
              high = mid;
            }
          }
          setCrop(bestValid);
          lastValidCropRef.current = bestValid;
        }
      } else {
        const eps = 1e-3;
        const tgtL = Math.abs(newL - oldL) < eps ? oldL : newL;
        const tgtT = Math.abs(newT - oldT) < eps ? oldT : newT;
        const tgtR = Math.abs(newR - oldR) < eps ? oldR : newR;
        const tgtB = Math.abs(newB - oldB) < eps ? oldB : newB;

        let currL = tgtL > oldL ? tgtL : oldL;
        let currT = tgtT > oldT ? tgtT : oldT;
        let currR = tgtR < oldR ? tgtR : oldR;
        let currB = tgtB < oldB ? tgtB : oldB;

        const expandEdge = (edge: 'L' | 'T' | 'R' | 'B', target: number) => {
          let low = 0,
            high = 1;
          const startVal = edge === 'L' ? currL : edge === 'T' ? currT : edge === 'R' ? currR : currB;
          let bestVal = startVal;

          for (let i = 0; i < 15; i++) {
            const mid = (low + high) / 2;
            const testVal = startVal + (target - startVal) * mid;

            const testCrop: PercentCrop = {
              unit: '%',
              x: edge === 'L' ? testVal : currL,
              y: edge === 'T' ? testVal : currT,
              width: (edge === 'R' ? testVal : currR) - (edge === 'L' ? testVal : currL),
              height: (edge === 'B' ? testVal : currB) - (edge === 'T' ? testVal : currT),
            };

            if (checkCropValid(toPixel(testCrop), W, H, rotation)) {
              bestVal = testVal;
              low = mid;
            } else {
              high = mid;
            }
          }

          if (edge === 'L') currL = bestVal;
          if (edge === 'T') currT = bestVal;
          if (edge === 'R') currR = bestVal;
          if (edge === 'B') currB = bestVal;
        };

        const expansions: Array<{ edge: 'L' | 'T' | 'R' | 'B'; target: number; delta: number }> = [];
        if (tgtL < oldL) expansions.push({ edge: 'L', target: tgtL, delta: oldL - tgtL });
        if (tgtT < oldT) expansions.push({ edge: 'T', target: tgtT, delta: oldT - tgtT });
        if (tgtR > oldR) expansions.push({ edge: 'R', target: tgtR, delta: tgtR - oldR });
        if (tgtB > oldB) expansions.push({ edge: 'B', target: tgtB, delta: tgtB - oldB });

        expansions.sort((a, b) => b.delta - a.delta);

        for (const exp of expansions) {
          expandEdge(exp.edge, exp.target);
        }

        const finalCrop: PercentCrop = {
          unit: '%',
          x: currL,
          y: currT,
          width: currR - currL,
          height: currB - currT,
        };

        setCrop(finalCrop);
        lastValidCropRef.current = finalCrop;
      }
    },
    [selectedImage, adjustments.orientationSteps, adjustments.rotation, adjustments.aspectRatio, liveRotation],
  );

  const handleCropComplete = useCallback(
    (_crop: Crop, pc: PercentCrop) => {
      if (!pc.width || !pc.height || !selectedImage?.width) {
        return;
      }
      if (liveRotation !== null) {
        return;
      }

      const orientationSteps = adjustments.orientationSteps || 0;
      const isSwapped = orientationSteps === 1 || orientationSteps === 3;

      const baseW = isSwapped ? selectedImage.height : selectedImage.width;
      const baseH = isSwapped ? selectedImage.width : selectedImage.height;

      const newPixelCrop: Crop = {
        unit: 'px',
        x: Math.ceil((pc.x / 100) * baseW),
        y: Math.ceil((pc.y / 100) * baseH),
        width: Math.floor((pc.width / 100) * baseW),
        height: Math.floor((pc.height / 100) * baseH),
      };

      setAdjustments((prev: Adjustments) => {
        if (JSON.stringify(newPixelCrop) !== JSON.stringify(prev.crop)) {
          return { ...prev, crop: newPixelCrop };
        }
        return prev;
      });
    },
    [selectedImage, adjustments.orientationSteps, setAdjustments, liveRotation],
  );

  if (!selectedImage) {
    return null;
  }

  const isZoomActionActive = !isPanningDisabled;
  const isMaxZoom = transformState.scale >= transformConfig.maxScale - 0.5;

  let cursorStyle = 'default';
  if (isPanningState && isMiddleMousePanningState) {
    cursorStyle = 'grabbing';
  } else if (isZoomActionActive) {
    if (isPanningState) {
      cursorStyle = 'grabbing';
    } else if (transformState.scale > 1.01) {
      cursorStyle = 'zoom-out';
    } else {
      cursorStyle = 'zoom-in';
    }
  }

  const isWgpuActive = appSettings?.useWgpuRenderer !== false && hasRenderedFirstFrame;

  return (
    <div
      className={cx(
        'flex-1 flex flex-col relative overflow-hidden min-h-0',
        !isInstantTransition && 'transition-all duration-300 ease-in-out',
        isFullScreen
          ? 'rounded-none p-0 gap-0'
          : cx('rounded-lg p-2 gap-2', appSettings?.useWgpuRenderer !== false ? 'bg-transparent' : 'bg-bg-secondary'),
      )}
    >
      <div
        className={cx(
          'shrink-0 relative z-10',
          !isInstantTransition && 'transition-all duration-300 ease-in-out',
          isFullScreen ? 'max-h-0 opacity-0 m-0' : 'max-h-25 opacity-100',
          toolbarOverflowVisible ? 'overflow-visible' : 'overflow-hidden',
        )}
      >
        <EditorToolbar
          canRedo={canRedo}
          canUndo={canUndo}
          isAndroid={isAndroid}
          isLoading={isLoading}
          onBackToLibrary={onBackToLibrary}
          onRedo={redo}
          onToggleFullScreen={handleToggleFullScreen}
          onToggleShowOriginal={toggleShowOriginal}
          onUndo={undo}
          selectedImage={selectedImage}
          showOriginal={showOriginal}
          showDateView={showExifDateView}
          onToggleDateView={() => {
            setShowExifDateView((prev) => !prev);
          }}
          adjustmentsHistory={adjustmentsHistory}
          adjustmentsHistoryIndex={adjustmentsHistoryIndex}
          goToAdjustmentsHistoryIndex={goToHistoryIndex}
        />
        {selectedImage.isOfflineSmartPreview === true && (
          <div
            className="mx-1 mb-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100"
            data-testid="offline-smart-preview-editor-warning"
          >
            {t('editor.offlineSmartPreview.warning')}
          </div>
        )}
      </div>

      <div
        className={cx(
          'flex-1 relative overflow-hidden touch-none',
          isFullScreen ? 'rounded-none' : 'rounded-lg',
          appSettings?.useWgpuRenderer !== false && !isFullScreen && 'ring-[9999px] ring-bg-secondary',
          !isWgpuActive && 'bg-bg-secondary',
        )}
        style={{ cursor: cursorStyle }}
        role="presentation"
        onContextMenu={onContextMenu}
        ref={imageContainerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      >
        {showSpinner && (
          <div
            className={cx(
              'absolute inset-0 bg-bg-secondary/80 flex items-center justify-center z-50 transition-opacity duration-300',
              isLoaderVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
          >
            <Loader2 size={48} className="animate-spin text-accent" />
          </div>
        )}

        <div
          ref={contentRef}
          className="w-full h-full flex items-center justify-center origin-top-left"
          style={{
            transform: `translate(${transformState.positionX}px, ${transformState.positionY}px) scale(${transformState.scale})`,
          }}
        >
          <ImageCanvas
            appSettings={appSettings}
            activeAiPatchContainerId={activeAiPatchContainerId}
            activeAiSubMaskId={activeAiSubMaskId}
            activeMaskContainerId={activeMaskContainerId}
            activeMaskId={activeMaskId}
            adjustments={adjustments}
            brushSettings={brushSettings}
            crop={crop}
            finalPreviewUrl={finalPreviewUrl}
            handleCropComplete={handleCropComplete}
            imageRenderSize={imageRenderSize}
            interactivePatch={interactivePatch}
            isAiEditing={isAiEditing}
            isCropping={isCropping}
            isMaskControlHovered={isMaskControlHovered}
            isMasking={isMasking}
            isStraightenActive={isStraightenActive}
            isRotationActive={isRotationActive}
            isSliderDragging={isSliderDragging}
            maskOverlayUrl={maskOverlayUrl}
            onGenerateAiMask={(id, start, end) => {
              if (!id) return;
              void handleGenerateAiMask(id, start, end);
            }}
            onLiveMaskPreview={handleLiveMaskPreview}
            onQuickErase={(id, start, end) => {
              void handleQuickErase(id, start, end);
            }}
            onSelectAiSubMask={(id) => {
              setEditor({ activeAiSubMaskId: id });
            }}
            onSelectMask={(id) => {
              setEditor({ activeMaskId: id });
            }}
            onStraighten={handleStraighten}
            selectedImage={selectedImage}
            setCrop={handleCropChange}
            setIsMaskHovered={setIsMaskHovered}
            setIsMaskTouchInteracting={setIsMaskTouchInteracting}
            showOriginal={showOriginal}
            transformedOriginalUrl={transformedOriginalUrl}
            uncroppedAdjustedPreviewUrl={uncroppedAdjustedPreviewUrl}
            updateSubMask={updateSubMaskLocal}
            isWbPickerActive={isWbPickerActive}
            onWbPicked={handleWbPicked}
            setAdjustments={setAdjustments}
            overlayRotation={overlayRotation}
            overlayMode={overlayMode}
            cursorStyle={cursorStyle}
            isMaxZoom={isMaxZoom}
            liveRotation={liveRotation}
            transformState={transformState}
            hasRenderedFirstFrame={hasRenderedFirstFrame}
          />
        </div>
      </div>
    </div>
  );
}
