import { invoke } from '@tauri-apps/api/core';
import cx from 'clsx';
import { Eye, Maximize, Minimize2, MoonStar } from 'lucide-react';
import {
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { Crop, PercentCrop } from 'react-image-crop';
import { useAiMasking } from '../../hooks/ai/useAiMasking';
import { useWgpuTransformSync } from '../../hooks/editor/useWgpuTransformSync';
import { useEditorViewportPhysics } from '../../hooks/viewport/useEditorViewportPhysics';
import {
  type BaseRenderSize,
  type ImageDimensions,
  type RenderSize,
  useImageRenderSize,
} from '../../hooks/viewport/useImageRenderSize';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import type { Adjustments, AiPatch, MaskContainer } from '../../utils/adjustments';
import {
  activeCropDraft,
  type CropInteraction,
  cropGeometryIdentity,
  getOrientedDimensions,
  isCropValidAfterRotation,
  percentCropFromPixelCrop,
  pixelCropFromPercentCrop,
  resolveCropForGeometryTransaction,
  resolveNextCropForGeometryChange,
  updateCropDraft,
} from '../../utils/cropUtils';
import { resolveComparePaneLayout } from '../../utils/editorCompare';
import {
  applyPointerOverscrollResistance,
  applyWheelPanResistance,
  getRecentPanVelocity,
  getWheelPanDelta,
  getWheelZoomExponent,
  getWheelZoomMultiplier,
  MAX_PAN_VELOCITY_SAMPLES,
  PAN_VELOCITY_THRESHOLD,
  WHEEL_SNAP_DELAY_MS,
} from '../../utils/editorGestureMath';
import { createEditorOverlayGeometry, overlayPoint, overlayRect } from '../../utils/editorOverlayGeometry';
import { createEditorPresentationDescriptor } from '../../utils/editorPresentationDescriptor';
import { getEditorPreviewDimensions } from '../../utils/editorPreviewDimensions';
import {
  reconcileViewportTransform,
  type ViewportFocalPoint,
  type ViewportSnapshot,
} from '../../utils/editorViewportBounds';
import {
  getEditorZoomDpr,
  getEditorZoomModeForCommand,
  getEditorZoomResolutionState,
  getEditorZoomSourceSize,
  isEditorPixelInspectionZoom,
  resolveEditorZoom,
} from '../../utils/editorZoom';
import {
  buildMaskOverlayInvokePayload,
  buildMaskOverlayRequestIdentity,
  buildMaskOverlayTriggerHash,
  isMaskOverlayResponseCurrent,
  type MaskPreviewDefinition,
} from '../../utils/mask/maskOverlayRequest';
import { toMaskParameterRecord } from '../../utils/mask/maskParameterAccess';
import {
  applyObjectPromptClick,
  imagePointFromCanvasClick,
  readObjectPromptCanvasState,
  writeObjectPromptCanvasState,
} from '../../utils/mask/objectMaskPromptCanvas';
import { openNegativeLabModalSession } from '../../utils/negative-lab/negativeLabModalSession';
import {
  getNegativeLabDisabledReasonKey,
  getNegativeLabSourceReadiness,
} from '../../utils/negative-lab/negativeLabSourceReadiness';
import { debounce } from '../../utils/timing';
import type { WhiteBalancePickerRuntimeReceipt } from '../../utils/whiteBalancePicker';
import { Panel } from '../ui/AppProperties';
import { editorChromeTokens } from '../ui/editorChromeTokens';
import EditorToolbar from './editor/EditorToolbar';
import ImageCanvas from './editor/ImageCanvas';
import { resolveViewerChromeRegionContract } from './editor/imageCanvasContracts';
import ViewerFooter from './editor/ViewerFooter';
import type { ViewerSamplerState } from './editor/ViewerSamplerHud';
import {
  isViewerDrag,
  resolveViewerInput,
  resolveViewerWheelIntent,
  shouldActivateTemporaryHand,
  type ViewerActiveTool,
  type ViewerGestureOwner,
  type ViewerPointerType,
} from './editor/viewerInputResolver';
import {
  getNextViewerLightsOutLevel,
  getViewerLightsOutLabel,
  resolveViewerFramePresentation,
} from './editor/viewerPresentationContracts';
import { Mask, type SubMask } from './right/layers/Masks';

interface TransformController {
  resetTransform(time?: number): void;
  setTransform(x: number, y: number, scale: number, time?: number): void;
  zoomIn(factor: number, time?: number): void;
  zoomOut(factor: number, time?: number): void;
}

interface DisplaySizeUpdate extends BaseRenderSize {
  scale: number;
}

interface MaskOverlayRequest {
  identity: string;
  jsAdjustments: Adjustments;
  maskDef: MaskPreviewDefinition;
  renderSize: RenderSize;
}

interface MaskOverlayRuntimeState {
  identity: string | null;
  status: 'current' | 'none' | 'stale-ignored';
}

interface EditorProps {
  isContiguousShell?: boolean;
  onBackToLibrary: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  transformWrapperRef: RefObject<TransformController | null>;
}

const viewerPointerType = (pointerType: string): ViewerPointerType =>
  pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse';

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
};

export default function Editor({
  isContiguousShell = false,
  onBackToLibrary,
  onContextMenu,
  transformWrapperRef,
}: EditorProps) {
  const { t } = useTranslation();
  const appSettings = useSettingsStore((s) => s.appSettings);
  const osPlatform = useSettingsStore((s) => s.osPlatform);
  const supportedTypes = useSettingsStore((s) => s.supportedTypes);
  const isFullScreen = useUIStore((s) => s.isFullScreen);
  const lightsOutLevel = useUIStore((s) => s.editorWorkspacePreferences.viewer.lightsOutLevel);
  const activeRightPanel = useUIStore((s) => s.activeRightPanel);
  const setUI = useUIStore((s) => s.setUI);
  const setDefaultEditorCompareMode = useUIStore((s) => s.setDefaultEditorCompareMode);
  const setEditorLightsOutLevel = useUIStore((s) => s.setEditorLightsOutLevel);
  const isLoading = useLibraryStore((s) => s.isViewLoading);
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const adjustments = useEditorStore((s) => s.adjustments);
  const adjustmentGeometryRevision = useEditorStore((s) => s.adjustmentSnapshot.geometryRevision);
  const adjustmentsHistory = useEditorStore((s) => s.history);
  const adjustmentsHistoryIndex = useEditorStore((s) => s.historyIndex);
  const finalPreviewUrl = useEditorStore((s) => s.finalPreviewUrl);
  const uncroppedAdjustedPreviewUrl = useEditorStore((s) => s.uncroppedAdjustedPreviewUrl);
  const transformedOriginalUrl = useEditorStore((s) => s.transformedOriginalUrl);
  const interactivePatch = useEditorStore((s) => s.interactivePatch);
  const gamutWarningOverlay = useEditorStore((s) => s.gamutWarningOverlay);
  const isGamutWarningOverlayVisible = useEditorStore((s) => s.isGamutWarningOverlayVisible);
  const isExportSoftProofEnabled = useEditorStore((s) => s.isExportSoftProofEnabled);
  const exportSoftProofRecipeId = useEditorStore((s) => s.exportSoftProofRecipeId);
  const exportSoftProofTransform = useEditorStore((s) => s.exportSoftProofTransform);
  const viewerSampleGraphRevision = JSON.stringify({
    exportSoftProofRecipeId,
    historyIndex: adjustmentsHistoryIndex,
    isExportSoftProofEnabled,
  });
  const compare = useEditorStore((s) => s.compare);
  const showOriginal = compare.isOriginalHeld || compare.mode === 'hold-original';
  const isSliderDragging = useEditorStore((s) => s.isSliderDragging);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomMode = useEditorStore((s) => s.zoomMode);
  const requestedPreviewResolution = useEditorStore((s) => s.requestedPreviewResolution);
  const renderedPreviewResolution = useEditorStore((s) => s.renderedPreviewResolution);
  const isRotationActive = useEditorStore((s) => s.isRotationActive);
  const overlayMode = useEditorStore((s) => s.overlayMode);
  const overlayRotation = useEditorStore((s) => s.overlayRotation);
  const maskOverlaySettings = useEditorStore((s) => s.maskOverlaySettings);
  const isStraightenActive = useEditorStore((s) => s.isStraightenActive);
  const isWbPickerActive = useEditorStore((s) => s.isWbPickerActive);
  const lastWhiteBalancePickerReceipt = useEditorStore((s) => s.lastWhiteBalancePickerReceipt);
  const liveRotation = useEditorStore((s) => s.liveRotation);
  const brushSettings = useEditorStore((s) => s.brushSettings);
  const activeMaskContainerId = useEditorStore((s) => s.activeMaskContainerId);
  const activeMaskId = useEditorStore((s) => s.activeMaskId);
  const activeAiPatchContainerId = useEditorStore((s) => s.activeAiPatchContainerId);
  const activeAiSubMaskId = useEditorStore((s) => s.activeAiSubMaskId);
  const isMaskControlHovered = useEditorStore((s) => s.isMaskControlHovered);
  const hasRenderedFirstFrame = useEditorStore((s) => s.hasRenderedFirstFrame);
  const wgpuFrameSerial = useEditorStore((s) => s.wgpuFrameSerial);
  const wgpuFailureSerial = useEditorStore((s) => s.wgpuFailureSerial);

  const setEditor = useEditorStore((s) => s.setEditor);
  const dispatchCompare = useEditorStore((s) => s.dispatchCompare);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
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
  const [cropInteraction, setCropInteraction] = useState<CropInteraction>({ kind: 'idle' });

  const [isMaskHovered, setIsMaskHovered] = useState(false);
  const [isMaskTouchInteracting, setIsMaskTouchInteracting] = useState(false);
  const [isLoaderVisible, setIsLoaderVisible] = useState(false);
  const [viewerSamplerState, setViewerSamplerState] = useState<ViewerSamplerState | null>(null);
  const [maskOverlayUrl, setMaskOverlayUrl] = useState<string | null>(null);
  const [maskOverlayRuntimeState, setMaskOverlayRuntimeState] = useState<MaskOverlayRuntimeState>({
    identity: null,
    status: 'none',
  });

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const previousFullScreenRef = useRef(isFullScreen);
  const previousLightsOutLevelRef = useRef(lightsOutLevel);
  const lightsOutRestoreFocusRef = useRef<HTMLElement | null>(null);
  const pendingZoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const suppressDoubleClickUntilRef = useRef(0);
  const isGeneratingOverlayRef = useRef(false);
  const pendingOverlayRequestRef = useRef<MaskOverlayRequest | null>(null);
  const latestOverlayRequestIdentityRef = useRef<string | null>(null);
  const processOverlayQueueRef = useRef<() => Promise<void>>(async () => {});
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pointerOwners = useRef<Map<number, ViewerGestureOwner>>(new Map());
  const pointerStarts = useRef<Map<number, { x: number; y: number }>>(new Map());
  const draggedPointers = useRef<Set<number>>(new Set());
  const lastPanPos = useRef<{ x: number; y: number } | null>(null);
  const lastPinch = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const panVelocityHistory = useRef<{ x: number; y: number; t: number }[]>([]);
  const isMiddleMousePanning = useRef(false);
  const hadViewerPanGesture = useRef(false);
  const [isTemporaryHand, setIsTemporaryHand] = useState(false);
  const [isViewerGestureDragging, setIsViewerGestureDragging] = useState(false);
  const [viewportLayoutEpoch, setViewportLayoutEpoch] = useState(0);
  const viewportLayoutEpochRef = useRef(0);

  const prevViewportSnapshotRef = useRef<ViewportSnapshot | null>(null);
  const prevViewportContextKeyRef = useRef<string | null>(null);
  const prevViewportDprRef = useRef<number | null>(null);
  const toggleShowOriginal = useCallback(() => {
    dispatchCompare({ type: 'toggle-original' });
  }, [dispatchCompare]);

  const handleToggleFullScreen = useCallback(() => {
    const currentlyZoomed = zoom > 1.01;
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
  }, [isFullScreen, selectedImage, setUI, zoom]);

  const handleCycleLightsOut = useCallback(() => {
    setEditorLightsOutLevel(getNextViewerLightsOutLevel(lightsOutLevel));
  }, [lightsOutLevel, setEditorLightsOutLevel]);

  const handleExitLightsOut = useCallback(() => {
    setEditorLightsOutLevel('off');
  }, [setEditorLightsOutLevel]);

  useEffect(() => {
    const previousLevel = previousLightsOutLevelRef.current;
    previousLightsOutLevelRef.current = lightsOutLevel;
    if (previousLevel === lightsOutLevel) return;

    if (previousLevel === 'off') {
      lightsOutRestoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    if (lightsOutLevel !== 'off') return;

    const restoreTarget = lightsOutRestoreFocusRef.current;
    lightsOutRestoreFocusRef.current = null;
    requestAnimationFrame(() => restoreTarget?.focus({ preventScroll: true }));
  }, [lightsOutLevel]);

  const negativeLabSourceReadiness = useMemo(
    () => getNegativeLabSourceReadiness(selectedImage ? [selectedImage.path] : [], supportedTypes),
    [selectedImage, supportedTypes],
  );
  const negativeLabDisabledReasonKey = getNegativeLabDisabledReasonKey(negativeLabSourceReadiness);

  const handleOpenNegativeLab = useCallback(() => {
    if (!negativeLabSourceReadiness.isReady) return;
    setUI((state) => ({
      negativeModalState: openNegativeLabModalSession(state.negativeModalState, negativeLabSourceReadiness.targetPaths),
    }));
  }, [negativeLabSourceReadiness, setUI]);

  const handleDisplaySizeChange = useCallback(
    (size: DisplaySizeUpdate) => {
      if (!size.scale) return;
      const nextDisplaySize = { width: size.width, height: size.height };
      const nextBaseRenderSize = {
        width: size.width / size.scale,
        height: size.height / size.scale,
        offsetX: size.offsetX || 0,
        offsetY: size.offsetY || 0,
        containerWidth: size.containerWidth || 0,
        containerHeight: size.containerHeight || 0,
      };

      setEditor((state) => {
        const previousDisplaySize = state.displaySize;
        const previousBaseRenderSize = state.baseRenderSize;
        const isUnchanged =
          previousDisplaySize.width === nextDisplaySize.width &&
          previousDisplaySize.height === nextDisplaySize.height &&
          previousBaseRenderSize.width === nextBaseRenderSize.width &&
          previousBaseRenderSize.height === nextBaseRenderSize.height &&
          previousBaseRenderSize.offsetX === nextBaseRenderSize.offsetX &&
          previousBaseRenderSize.offsetY === nextBaseRenderSize.offsetY &&
          previousBaseRenderSize.containerWidth === nextBaseRenderSize.containerWidth &&
          previousBaseRenderSize.containerHeight === nextBaseRenderSize.containerHeight;
        if (isUnchanged) return {};
        return {
          baseRenderSize: nextBaseRenderSize,
          displaySize: nextDisplaySize,
          viewportEpoch: state.viewportEpoch + 1,
        };
      });
    },
    [setEditor],
  );

  const handleStraighten = useCallback(
    (angleCorrection: number) => {
      setAdjustments((prev: Adjustments) => {
        const newRotation = (prev.rotation || 0) + angleCorrection;
        if (!selectedImage?.width || !selectedImage.height) return { ...prev, rotation: newRotation };
        return {
          ...prev,
          crop: resolveCropForGeometryTransaction(
            prev.crop,
            selectedImage.width,
            selectedImage.height,
            {
              aspectRatio: prev.aspectRatio,
              orientationSteps: prev.orientationSteps || 0,
              rotation: prev.rotation || 0,
            },
            {
              aspectRatio: prev.aspectRatio,
              orientationSteps: prev.orientationSteps || 0,
              rotation: newRotation,
            },
          ),
          rotation: newRotation,
        };
      });
      setEditor({ isStraightenActive: false });
    },
    [selectedImage, setAdjustments, setEditor],
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

  const handleWbPicked = useCallback(
    (receipt: WhiteBalancePickerRuntimeReceipt, nextAdjustments: Adjustments) => {
      setEditor({
        adjustments: nextAdjustments,
        exportSoftProofTransform: null,
        finalPreviewUrl: null,
        gamutWarningOverlay: null,
        interactivePatch: null,
        isWbPickerActive: false,
        lastWhiteBalancePickerReceipt: receipt,
        previewScopeStatus: null,
        transformedOriginalUrl: null,
        uncroppedAdjustedPreviewUrl: null,
      });
      pushHistory(nextAdjustments);
    },
    [pushHistory, setEditor],
  );

  useEffect(() => {
    if (previousFullScreenRef.current === isFullScreen) return;
    previousFullScreenRef.current = isFullScreen;
    dispatchCompare({ type: 'exit' });
  }, [dispatchCompare, isFullScreen]);

  const isCropping = activeRightPanel === Panel.Crop;
  const isMasking = activeRightPanel === Panel.Masks;
  const isAiEditing = activeRightPanel === Panel.Ai;

  const croppedDimensions = useMemo<ImageDimensions | null>(() => {
    if (adjustments.crop) {
      return { width: adjustments.crop.width, height: adjustments.crop.height };
    }
    return getEditorPreviewDimensions(selectedImage, adjustments.orientationSteps || 0);
  }, [selectedImage, adjustments.crop, adjustments.orientationSteps]);
  const viewportContextKey = useMemo(() => {
    const crop = adjustments.crop;
    return JSON.stringify({
      dimensions: croppedDimensions,
      isReady: selectedImage?.isReady ?? false,
      originalSize: selectedImage ? { height: selectedImage.height, width: selectedImage.width } : null,
      path: selectedImage?.path ?? null,
      crop: crop ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : null,
      orientationSteps: adjustments.orientationSteps || 0,
    });
  }, [
    adjustments.crop,
    adjustments.orientationSteps,
    croppedDimensions,
    selectedImage?.height,
    selectedImage?.isReady,
    selectedImage?.path,
    selectedImage?.width,
  ]);

  const singleImageRenderSize = useImageRenderSize(imageContainerRef, croppedDimensions);
  const comparePaneLayout = useMemo(() => {
    if (!croppedDimensions) {
      return { edited: singleImageRenderSize, original: singleImageRenderSize };
    }
    return resolveComparePaneLayout({
      imageDimensions: croppedDimensions,
      mode: compare.mode,
      orientation: compare.orientation,
      viewport: {
        height: singleImageRenderSize.height + singleImageRenderSize.offsetY * 2,
        width: singleImageRenderSize.width + singleImageRenderSize.offsetX * 2,
      },
    });
  }, [compare.mode, compare.orientation, croppedDimensions, singleImageRenderSize]);
  const imageRenderSize = compare.mode === 'side-by-side' ? comparePaneLayout.edited : singleImageRenderSize;
  const [devicePixelRatio, setDevicePixelRatio] = useState(() =>
    getEditorZoomDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio),
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const synchronizeDpr = () => setDevicePixelRatio(getEditorZoomDpr(window.devicePixelRatio));
    const mediaQuery = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    window.addEventListener('resize', synchronizeDpr);
    window.visualViewport?.addEventListener('resize', synchronizeDpr);
    mediaQuery.addEventListener('change', synchronizeDpr);
    return () => {
      window.removeEventListener('resize', synchronizeDpr);
      window.visualViewport?.removeEventListener('resize', synchronizeDpr);
      mediaQuery.removeEventListener('change', synchronizeDpr);
    };
  }, [devicePixelRatio]);
  const resolvedZoom = useMemo(
    () =>
      resolveEditorZoom({
        devicePixelRatio,
        mode: zoomMode,
        renderSize: imageRenderSize,
        sourceSize: getEditorZoomSourceSize({
          crop: adjustments.crop,
          orientationSteps: adjustments.orientationSteps,
          originalSize: selectedImage
            ? { height: selectedImage.height, width: selectedImage.width }
            : { height: 0, width: 0 },
        }),
        viewportSize: {
          height: imageContainerRef.current?.clientHeight ?? 0,
          width: imageContainerRef.current?.clientWidth ?? 0,
        },
      }),
    [adjustments.crop, adjustments.orientationSteps, devicePixelRatio, imageRenderSize, selectedImage, zoomMode],
  );
  const zoomResolutionState = getEditorZoomResolutionState({
    renderedPreviewResolution,
    requestedPreviewResolution,
    resolvedZoom,
  });
  const handleZoomed = useCallback(
    (state: { scale: number }) => {
      setEditor({ zoom: state.scale });
    },
    [setEditor],
  );
  const {
    animationFrameId,
    animateTransform,
    applyTransform,
    captureFocalPoint,
    clampToBounds,
    focalPointRef,
    getTransformBounds,
    imageRenderSizeRef,
    isPanningState,
    maxScaleRef,
    minScaleRef,
    physicsFrameId,
    setIsMiddleMousePanningState,
    setIsPanningState,
    startPhysicsLoop,
    transformState,
    transformStateRef,
    wheelSnapTimeout,
  } = useEditorViewportPhysics({
    contentRef,
    devicePixelRatio,
    hasSelectedImage: selectedImage !== null,
    imageContainerRef,
    imageRenderSize,
    onZoomed: handleZoomed,
  });
  const overlayGeometryIdentity = JSON.stringify({
    crop: adjustments.crop,
    dpr: devicePixelRatio,
    orientationSteps: adjustments.orientationSteps,
    renderSize: imageRenderSize,
    rotationDegrees: liveRotation ?? adjustments.rotation ?? 0,
    sourceHeight: selectedImage?.height ?? 0,
    sourceWidth: selectedImage?.width ?? 0,
    transformState,
  });
  const previousOverlayGeometryIdentityRef = useRef<string | null>(null);
  const overlayGeometryEpochRef = useRef(0);
  if (previousOverlayGeometryIdentityRef.current !== overlayGeometryIdentity) {
    previousOverlayGeometryIdentityRef.current = overlayGeometryIdentity;
    overlayGeometryEpochRef.current += 1;
  }
  const overlayGeometry = useMemo(
    () =>
      createEditorOverlayGeometry({
        crop: adjustments.crop,
        devicePixelRatio,
        geometryEpoch: overlayGeometryEpochRef.current,
        orientationSteps: adjustments.orientationSteps ?? 0,
        renderSize: imageRenderSize,
        rotationDegrees: liveRotation ?? adjustments.rotation ?? 0,
        semanticZoom: resolvedZoom,
        sourceSize: { height: selectedImage?.height ?? 0, width: selectedImage?.width ?? 0 },
        transform: transformState,
        viewportSizeCssPixels: {
          height: imageRenderSize.height + imageRenderSize.offsetY * 2,
          width: imageRenderSize.width + imageRenderSize.offsetX * 2,
        },
      }),
    [
      adjustments.crop,
      adjustments.orientationSteps,
      adjustments.rotation,
      devicePixelRatio,
      imageRenderSize,
      liveRotation,
      overlayGeometryIdentity,
      resolvedZoom,
      selectedImage?.height,
      selectedImage?.width,
      transformState,
    ],
  );
  const presentationDescriptor = useMemo(
    () =>
      createEditorPresentationDescriptor({
        colorTransformIdentity: 'working-display:v1',
        compareIdentity: JSON.stringify(compare),
        geometry: overlayGeometry,
        graphRevision: viewerSampleGraphRevision,
        overlayIdentity: JSON.stringify({
          gamutWarning: isGamutWarningOverlayVisible,
          mask: maskOverlayRuntimeState.identity,
          maskStatus: maskOverlayRuntimeState.status,
          mode: overlayMode,
        }),
        proofTransformIdentity: JSON.stringify({
          enabled: isExportSoftProofEnabled,
          recipeId: exportSoftProofRecipeId,
          transform: exportSoftProofTransform,
        }),
        quality: isSliderDragging ? 'interactive' : 'settled',
        sourceIdentity: selectedImage?.path ?? '',
        textureSize: {
          height: imageRenderSize.height,
          width: imageRenderSize.width,
        },
      }),
    [
      compare,
      exportSoftProofRecipeId,
      exportSoftProofTransform,
      imageRenderSize.height,
      imageRenderSize.width,
      isExportSoftProofEnabled,
      isGamutWarningOverlayVisible,
      isSliderDragging,
      maskOverlayRuntimeState.identity,
      maskOverlayRuntimeState.status,
      overlayGeometry,
      overlayMode,
      selectedImage?.path,
      viewerSampleGraphRevision,
    ],
  );

  const zoomToCenter = useCallback(
    (newScale: number, duration: number) => {
      const container = imageContainerRef.current;
      if (!container) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const centerX = cw / 2;
      const centerY = ch / 2;
      captureFocalPoint({ x: centerX, y: centerY }, 'center');

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
    [animateTransform, applyTransform, captureFocalPoint, clampToBounds, transformStateRef],
  );

  const zoomToAnchor = useCallback(
    (anchor: { x: number; y: number }, newScale: number, duration: number) => {
      const current = transformStateRef.current;
      captureFocalPoint(anchor, 'pointer');
      const ratio = newScale / current.scale;
      const x = anchor.x - (anchor.x - current.positionX) * ratio;
      const y = anchor.y - (anchor.y - current.positionY) * ratio;
      animateTransform(x, y, newScale, duration);
    },
    [animateTransform, captureFocalPoint, transformStateRef],
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
        const container = imageContainerRef.current;
        if (container) captureFocalPoint({ x: container.clientWidth / 2, y: container.clientHeight / 2 }, 'center');
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
    [animateTransform, applyTransform, captureFocalPoint, clampToBounds, transformStateRef, zoomToCenter],
  );

  useEffect(() => {
    if (!transformWrapperRef.current || !imageRenderSize.width || !imageRenderSize.height) return;

    const currentScale = transformStateRef.current.scale || 1;
    const anchor = pendingZoomAnchorRef.current;
    pendingZoomAnchorRef.current = null;
    if (Math.abs(currentScale - resolvedZoom.transformScale) < 0.001) return;
    if (anchor) {
      zoomToAnchor(anchor, resolvedZoom.transformScale, 200);
      return;
    }
    zoomToCenter(resolvedZoom.transformScale, 200);
  }, [
    imageRenderSize.height,
    imageRenderSize.width,
    resolvedZoom.transformScale,
    transformStateRef,
    transformWrapperRef,
    zoomToAnchor,
    zoomToCenter,
  ]);

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
  const isObjectPromptActive = isMasking && activeSubMask?.type === Mask.AiObject;
  const activeObjectPromptState = useMemo(
    () => (isObjectPromptActive ? readObjectPromptCanvasState(activeSubMask.parameters) : null),
    [activeSubMask, isObjectPromptActive],
  );
  const hasActiveRetouchTool = useMemo(
    () =>
      isMasking &&
      activeMaskContainerId !== null &&
      adjustments.masks.some(
        (mask) =>
          mask.id === activeMaskContainerId &&
          (mask.retouchCloneSource !== undefined || mask.retouchRemoveSource !== undefined),
      ),
    [activeMaskContainerId, adjustments.masks, isMasking],
  );

  const activeViewerTool = useMemo<ViewerActiveTool>(() => {
    if (isWbPickerActive) return 'white-balance';
    if (isCropping) return 'crop';
    if (hasActiveRetouchTool) return 'retouch';
    if (isMaskHovered || isMaskTouchInteracting) return 'mask';
    if (isObjectPromptActive || activeSubMask?.type === Mask.AiSubject) return 'object-prompt';
    if (
      activeSubMask?.type === Mask.Brush ||
      activeSubMask?.type === Mask.Flow ||
      activeSubMask?.type === Mask.QuickEraser
    ) {
      return 'brush';
    }
    if (
      activeSubMask?.type === Mask.Color ||
      activeSubMask?.type === Mask.Luminance ||
      activeSubMaskParameters['isInitialDraw'] === true
    ) {
      return 'mask';
    }
    return 'none';
  }, [
    activeSubMask?.type,
    activeSubMaskParameters,
    hasActiveRetouchTool,
    isCropping,
    isMaskHovered,
    isMaskTouchInteracting,
    isObjectPromptActive,
    isWbPickerActive,
  ]);

  const cancelViewerMotion = useCallback(() => {
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    if (physicsFrameId.current) cancelAnimationFrame(physicsFrameId.current);
    if (wheelSnapTimeout.current) clearTimeout(wheelSnapTimeout.current);
  }, [animationFrameId, physicsFrameId, wheelSnapTimeout]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const focusContext = isEditableKeyboardTarget(event.target) ? 'editable' : 'viewer';
      if (!shouldActivateTemporaryHand({ focusContext, key: event.key })) return;
      event.preventDefault();
      setIsTemporaryHand(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;
      setIsTemporaryHand(false);
    };
    const handleWindowBlur = () => setIsTemporaryHand(false);

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelViewerMotion();

      const isTrackpad = appSettings?.canvasInputMode === 'trackpad';
      const zoomSpeedMult = getWheelZoomMultiplier(isTrackpad, appSettings?.zoomSpeedMultiplier ?? 1);
      const isZoomIntent =
        resolveViewerWheelIntent({
          ctrlKey: e.ctrlKey,
          inputMode: isTrackpad ? 'trackpad' : 'mouse',
        }) === 'zoom';

      if (isZoomIntent) {
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const exponent = getWheelZoomExponent(e, zoomSpeedMult);

        let newScale = transformStateRef.current.scale * Math.exp(-exponent);
        newScale = Math.max(minScaleRef.current, Math.min(maxScaleRef.current, newScale));

        const ratio = newScale / transformStateRef.current.scale;
        const newX = mouseX - (mouseX - transformStateRef.current.positionX) * ratio;
        const newY = mouseY - (mouseY - transformStateRef.current.positionY) * ratio;

        const bounded = clampToBounds(newX, newY, newScale);
        applyTransform(bounded.x, bounded.y, bounded.scale);
        captureFocalPoint({ x: mouseX, y: mouseY }, 'pointer');
      } else {
        if (transformStateRef.current.scale <= 1.01) return;

        const { positionX: curX, positionY: curY, scale } = transformStateRef.current;
        const bounds = getTransformBounds(scale);

        const { dx, dy } = getWheelPanDelta(e, isTrackpad);

        const { x: newX, y: newY } = applyWheelPanResistance(curX - dx, curY - dy, bounds);

        applyTransform(newX, newY, scale);
        const rect = container.getBoundingClientRect();
        captureFocalPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top }, 'pointer');

        if (wheelSnapTimeout.current) clearTimeout(wheelSnapTimeout.current);
        wheelSnapTimeout.current = window.setTimeout(() => {
          startPhysicsLoop(0, 0);
        }, WHEEL_SNAP_DELAY_MS);
      }
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleNativeWheel);
    };
  }, [
    applyTransform,
    captureFocalPoint,
    cancelViewerMotion,
    clampToBounds,
    getTransformBounds,
    maxScaleRef,
    minScaleRef,
    startPhysicsLoop,
    transformStateRef,
    wheelSnapTimeout,
    appSettings?.canvasInputMode,
    appSettings?.zoomSpeedMultiplier,
  ]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target instanceof Element && e.target.closest('[data-canvas-pointer-owner="compare-divider"]')) return;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pointerStarts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const resolution = resolveViewerInput({
        activeTool: activeViewerTool,
        button: e.button,
        focusContext: 'viewer',
        isDragging: false,
        isTemporaryHand,
        pointerCount: activePointers.current.size,
        pointerType: viewerPointerType(e.pointerType),
        zoomed: transformStateRef.current.scale > 1.01,
      });
      pointerOwners.current.set(e.pointerId, resolution.owner);
      cancelViewerMotion();

      if (resolution.owner !== 'viewer-pan') return;

      hadViewerPanGesture.current = true;
      panVelocityHistory.current = [];
      const rect = e.currentTarget.getBoundingClientRect();
      captureFocalPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top }, 'pointer');
      if (resolution.reason === 'middle-button') {
        isMiddleMousePanning.current = true;
        setIsMiddleMousePanningState(true);
      }

      if (activePointers.current.size === 1) {
        lastPanPos.current = { x: e.clientX, y: e.clientY };
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

      if (resolution.shouldCapturePointer) e.currentTarget.setPointerCapture(e.pointerId);
    },
    [
      activeViewerTool,
      cancelViewerMotion,
      captureFocalPoint,
      isTemporaryHand,
      setIsMiddleMousePanningState,
      transformStateRef,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!activePointers.current.has(e.pointerId)) return;
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const start = pointerStarts.current.get(e.pointerId);
      if (start && isViewerDrag(start, { x: e.clientX, y: e.clientY })) {
        draggedPointers.current.add(e.pointerId);
        suppressDoubleClickUntilRef.current = performance.now() + 600;
        setIsViewerGestureDragging(true);
      }

      const isViewerOwner = pointerOwners.current.get(e.pointerId) === 'viewer-pan';
      if (
        activePointers.current.size === 1 &&
        lastPanPos.current &&
        isViewerOwner &&
        draggedPointers.current.has(e.pointerId)
      ) {
        setIsPanningState(true);
        panVelocityHistory.current.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (panVelocityHistory.current.length > MAX_PAN_VELOCITY_SAMPLES) panVelocityHistory.current.shift();

        let dx = e.clientX - lastPanPos.current.x;
        let dy = e.clientY - lastPanPos.current.y;
        lastPanPos.current = { x: e.clientX, y: e.clientY };

        const bounds = getTransformBounds(transformStateRef.current.scale);
        const curX = transformStateRef.current.positionX;
        const curY = transformStateRef.current.positionY;

        ({ dx, dy } = applyPointerOverscrollResistance(dx, dy, { x: curX, y: curY }, bounds));

        applyTransform(curX + dx, curY + dy, transformStateRef.current.scale);
        const rect = imageContainerRef.current?.getBoundingClientRect();
        if (rect) captureFocalPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top }, 'pointer');
      } else if (activePointers.current.size === 2 && lastPinch.current) {
        setIsPanningState(true);
        setIsViewerGestureDragging(true);
        suppressDoubleClickUntilRef.current = performance.now() + 600;
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
          captureFocalPoint({ x: mouseX, y: mouseY }, 'pointer');
        }

        lastPinch.current = { dist, midX, midY };
      }
    },
    [
      applyTransform,
      captureFocalPoint,
      clampToBounds,
      getTransformBounds,
      maxScaleRef,
      minScaleRef,
      setIsPanningState,
      transformStateRef,
    ],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const wasViewerGesture = pointerOwners.current.get(e.pointerId) === 'viewer-pan';
      const dragged = draggedPointers.current.delete(e.pointerId);
      if (dragged) suppressDoubleClickUntilRef.current = performance.now() + 600;
      activePointers.current.delete(e.pointerId);
      pointerOwners.current.delete(e.pointerId);
      pointerStarts.current.delete(e.pointerId);

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      if (activePointers.current.size === 1) {
        const remainingPointer = Array.from(activePointers.current.entries())[0];
        if (!remainingPointer) return;
        const [pointerId, pointer] = remainingPointer;
        lastPanPos.current =
          pointerOwners.current.get(pointerId) === 'viewer-pan' ? { x: pointer.x, y: pointer.y } : null;
        lastPinch.current = null;
      } else if (activePointers.current.size === 0) {
        lastPanPos.current = null;
        lastPinch.current = null;
        setIsPanningState(false);
        setIsViewerGestureDragging(false);
        isMiddleMousePanning.current = false;
        setIsMiddleMousePanningState(false);
        const container = imageContainerRef.current;
        if (container) {
          captureFocalPoint({ x: container.clientWidth / 2, y: container.clientHeight / 2 }, 'center');
        }

        const { vx, vy } = getRecentPanVelocity(panVelocityHistory.current, performance.now());

        const { positionX, positionY, scale } = transformStateRef.current;
        const bounds = getTransformBounds(scale);
        const outOfBounds =
          positionX > bounds.maxX || positionX < bounds.minX || positionY > bounds.maxY || positionY < bounds.minY;

        if (
          wasViewerGesture &&
          hadViewerPanGesture.current &&
          (Math.abs(vx) > PAN_VELOCITY_THRESHOLD || Math.abs(vy) > PAN_VELOCITY_THRESHOLD || outOfBounds)
        ) {
          startPhysicsLoop(vx, vy);
        }
        hadViewerPanGesture.current = false;
      }
    },
    [
      getTransformBounds,
      setIsMiddleMousePanningState,
      setIsPanningState,
      setIsViewerGestureDragging,
      startPhysicsLoop,
      captureFocalPoint,
      transformStateRef,
    ],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail > 1) return;
      if (e.button !== 0) return;
      if (performance.now() < suppressDoubleClickUntilRef.current) return;
      const container = imageContainerRef.current;

      if (isObjectPromptActive && activeObjectPromptState !== null && activeMaskId !== null && container !== null) {
        const rect = container.getBoundingClientRect();
        const point = imagePointFromCanvasClick({ x: e.clientX - rect.left, y: e.clientY - rect.top }, overlayGeometry);
        if (point !== null) {
          const nextState = applyObjectPromptClick(activeObjectPromptState, point);
          updateSubMaskLocal(activeMaskId, {
            parameters: writeObjectPromptCanvasState(activeSubMask.parameters, nextState),
          });
        }
        return;
      }
    },
    [
      activeMaskId,
      activeObjectPromptState,
      activeSubMask,
      isObjectPromptActive,
      overlayGeometry,
      transformStateRef,
      updateSubMaskLocal,
    ],
  );

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (compare.mode !== 'hold-original' && !compare.isOriginalHeld) return;

    const syncTimer = setTimeout(() => {
      dispatchCompare({ type: 'exit' });
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [adjustments, compare.isOriginalHeld, compare.mode, dispatchCompare]);

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
    if (!container || imageRenderSize.width === 0 || imageRenderSize.height === 0) return;

    const currentSnapshot: ViewportSnapshot = {
      containerWidth: container.clientWidth,
      containerHeight: container.clientHeight,
      renderSize: imageRenderSize,
    };
    const contextChanged =
      prevViewportContextKeyRef.current !== null && prevViewportContextKeyRef.current !== viewportContextKey;
    const previousSnapshot = prevViewportSnapshotRef.current;
    const geometryChanged =
      previousSnapshot === null ||
      previousSnapshot.containerWidth !== currentSnapshot.containerWidth ||
      previousSnapshot.containerHeight !== currentSnapshot.containerHeight ||
      previousSnapshot.renderSize.width !== currentSnapshot.renderSize.width ||
      previousSnapshot.renderSize.height !== currentSnapshot.renderSize.height ||
      previousSnapshot.renderSize.offsetX !== currentSnapshot.renderSize.offsetX ||
      previousSnapshot.renderSize.offsetY !== currentSnapshot.renderSize.offsetY;
    const dprChanged = prevViewportDprRef.current !== null && prevViewportDprRef.current !== devicePixelRatio;
    const layoutChanged = geometryChanged || dprChanged;
    const focalPoint = focalPointRef.current;
    let viewportAnchor = null;
    if (focalPoint?.source === 'pointer') {
      const rect = container.getBoundingClientRect();
      const activePoints = Array.from(activePointers.current.values());
      const firstPoint = activePoints[0];
      if (firstPoint) {
        const secondPoint = activePoints[1];
        viewportAnchor = secondPoint
          ? {
              x: (firstPoint.x + secondPoint.x) / 2 - rect.left,
              y: (firstPoint.y + secondPoint.y) / 2 - rect.top,
            }
          : { x: firstPoint.x - rect.left, y: firstPoint.y - rect.top };
      } else {
        viewportAnchor = { x: focalPoint.viewportX, y: focalPoint.viewportY };
      }
    } else if (focalPoint?.source === 'navigator') {
      viewportAnchor = { x: focalPoint.viewportX, y: focalPoint.viewportY };
    }
    const targetScale = layoutChanged || contextChanged ? resolvedZoom.transformScale : transformStateRef.current.scale;
    const nextTransform = reconcileViewportTransform({
      contextChanged,
      current: currentSnapshot,
      focalPoint,
      mode: zoomMode,
      previous: previousSnapshot,
      targetScale,
      transform: transformStateRef.current,
      viewportAnchor,
    });

    if (contextChanged) {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (physicsFrameId.current) cancelAnimationFrame(physicsFrameId.current);
      activePointers.current.clear();
      pointerOwners.current.clear();
      pointerStarts.current.clear();
      draggedPointers.current.clear();
      hadViewerPanGesture.current = false;
      lastPanPos.current = null;
      lastPinch.current = null;
      panVelocityHistory.current = [];
      setIsPanningState(false);
      setIsMiddleMousePanningState(false);
      setIsViewerGestureDragging(false);
      focalPointRef.current = null;
    }

    if (
      Math.abs(nextTransform.scale - transformStateRef.current.scale) > 0.001 ||
      Math.abs(nextTransform.positionX - transformStateRef.current.positionX) > 0.5 ||
      Math.abs(nextTransform.positionY - transformStateRef.current.positionY) > 0.5
    ) {
      applyTransform(nextTransform.positionX, nextTransform.positionY, nextTransform.scale);
    }

    if (layoutChanged || contextChanged) {
      viewportLayoutEpochRef.current += 1;
      setViewportLayoutEpoch(viewportLayoutEpochRef.current);
    }
    if (layoutChanged || contextChanged) {
      handleDisplaySizeChange({
        containerHeight: currentSnapshot.containerHeight,
        containerWidth: currentSnapshot.containerWidth,
        height: imageRenderSize.height * nextTransform.scale,
        offsetX: imageRenderSize.offsetX,
        offsetY: imageRenderSize.offsetY,
        scale: nextTransform.scale,
        width: imageRenderSize.width * nextTransform.scale,
      });
    }

    prevViewportSnapshotRef.current = currentSnapshot;
    prevViewportContextKeyRef.current = viewportContextKey;
    prevViewportDprRef.current = devicePixelRatio;
  }, [
    animationFrameId,
    focalPointRef,
    imageRenderSize,
    physicsFrameId,
    viewportContextKey,
    applyTransform,
    devicePixelRatio,
    handleDisplaySizeChange,
    resolvedZoom.transformScale,
    setIsMiddleMousePanningState,
    setIsPanningState,
    setIsViewerGestureDragging,
    transformStateRef,
    zoomMode,
  ]);

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

    const { identity, maskDef, renderSize, jsAdjustments } = pendingOverlayRequestRef.current;
    pendingOverlayRequestRef.current = null;

    const { maskOverlaySettings, patchResidency } = useEditorStore.getState();
    const overlayPayload = buildMaskOverlayInvokePayload({
      jsAdjustments,
      maskDef,
      maskOverlaySettings,
      patchesSentToBackend: patchResidency.snapshot().residentIds,
      renderSize,
    });

    if (overlayPayload === null) {
      setMaskOverlayUrl(null);
      setMaskOverlayRuntimeState({ identity, status: 'none' });
      return;
    }

    isGeneratingOverlayRef.current = true;
    try {
      const dataUrl: string = await invoke(Invokes.GenerateMaskOverlay, { ...overlayPayload });
      if (!isMaskOverlayResponseCurrent(latestOverlayRequestIdentityRef.current, identity)) {
        setMaskOverlayRuntimeState({ identity, status: 'stale-ignored' });
        return;
      }

      if (dataUrl) {
        setMaskOverlayUrl(dataUrl);
        setMaskOverlayRuntimeState({ identity, status: 'current' });
      } else {
        setMaskOverlayUrl(null);
        setMaskOverlayRuntimeState({ identity, status: 'none' });
      }
    } catch (e) {
      console.error('Failed to generate live mask overlay:', e);
      setMaskOverlayUrl(null);
      setMaskOverlayRuntimeState({ identity, status: 'none' });
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

  const handleWgpuFailure = useCallback(() => {
    setEditor((state) => ({ wgpuFailureSerial: state.wgpuFailureSerial + 1 }));
  }, [setEditor]);
  const handleWgpuFrameCommitted = useCallback(() => {
    setEditor((state) => ({ wgpuFrameSerial: state.wgpuFrameSerial + 1 }));
  }, [setEditor]);

  const requestMaskOverlay = useCallback(
    (maskDef: MaskPreviewDefinition, renderSize: RenderSize, currentAdjustments: Adjustments) => {
      const { maskOverlaySettings: currentMaskOverlaySettings } = useEditorStore.getState();
      const triggerHash = buildMaskOverlayTriggerHash({
        activeMaskDef: maskDef as AiPatch | MaskContainer,
        adjustments: currentAdjustments,
        imageRenderSize: { height: renderSize.height, width: renderSize.width },
        maskOverlaySettings: currentMaskOverlaySettings,
      });
      const identity = buildMaskOverlayRequestIdentity({
        renderSize,
        selectedImagePath: selectedImage?.path,
        triggerHash,
      });
      latestOverlayRequestIdentityRef.current = identity;
      pendingOverlayRequestRef.current = { identity, maskDef, renderSize, jsAdjustments: currentAdjustments };
      void processOverlayQueue();
    },
    [processOverlayQueue, selectedImage?.path],
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

  useWgpuTransformSync({
    finalPreviewUrl,
    hasRenderedFirstFrame,
    imageContainerRef,
    imageRenderSizeRef,
    isCropping,
    isReady: selectedImage?.isReady ?? false,
    maxScaleRef,
    onWgpuFrameCommitted: handleWgpuFrameCommitted,
    onWgpuFailure: handleWgpuFailure,
    presentationDescriptor,
    showOriginal,
    theme: appSettings?.theme,
    transformStateRef,
    uncroppedAdjustedPreviewUrl,
    useWgpuRenderer: appSettings?.useWgpuRenderer,
  });

  const overlayTriggerHash = useMemo(() => {
    let activeMaskDef: MaskContainer | AiPatch | undefined;
    if (activeRightPanel === Panel.Masks && activeMaskContainerId) {
      activeMaskDef = adjustments.masks.find((c: MaskContainer) => c.id === activeMaskContainerId);
    } else if (activeRightPanel === Panel.Ai && activeAiPatchContainerId) {
      activeMaskDef = adjustments.aiPatches.find((p: AiPatch) => p.id === activeAiPatchContainerId);
    }

    if (!activeMaskDef) return null;

    return buildMaskOverlayTriggerHash({
      activeMaskDef,
      adjustments,
      imageRenderSize: { height: imageRenderSize.height, width: imageRenderSize.width },
      maskOverlaySettings,
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

  const cropSessionKey = selectedImage ? `${selectedImage.path}:${isCropping ? 'crop' : 'inactive'}` : 'no-image';
  const cropGeometryKey = selectedImage
    ? cropGeometryIdentity(selectedImage.path, selectedImage.width, selectedImage.height, {
        aspectRatio: adjustments.aspectRatio,
        orientationSteps: adjustments.orientationSteps || 0,
        rotation: liveRotation ?? adjustments.rotation ?? 0,
      })
    : 'no-image';
  const orientedCropDimensions = selectedImage
    ? getOrientedDimensions(selectedImage.width, selectedImage.height, adjustments.orientationSteps || 0)
    : null;
  const displayedCanonicalPixelCrop =
    selectedImage && liveRotation !== null
      ? resolveNextCropForGeometryChange({
          aspectRatio: adjustments.aspectRatio,
          currentCrop: adjustments.crop,
          effectiveRotation: liveRotation,
          imageHeight: selectedImage.height,
          imageWidth: selectedImage.width,
          isDraggingRotation: true,
          orientationSteps: adjustments.orientationSteps || 0,
          previousParams: {
            aspectRatio: adjustments.aspectRatio,
            orientationSteps: adjustments.orientationSteps || 0,
            rotation: adjustments.rotation || 0,
          },
          rotation: adjustments.rotation || 0,
        }).nextPixelCrop
      : adjustments.crop;
  const canonicalPercentCrop =
    isCropping && displayedCanonicalPixelCrop && orientedCropDimensions
      ? percentCropFromPixelCrop(
          displayedCanonicalPixelCrop,
          orientedCropDimensions.width,
          orientedCropDimensions.height,
        )
      : null;
  const crop: Crop | null = activeCropDraft(cropInteraction, cropSessionKey, cropGeometryKey) ?? canonicalPercentCrop;

  const handleCropChange = useCallback(
    (_pixelCrop: Crop, percentCrop: PercentCrop) => {
      if (!selectedImage) return;

      let lastValidPercentCrop =
        cropInteraction.kind === 'dragging' &&
        cropInteraction.sessionKey === cropSessionKey &&
        cropInteraction.geometryIdentity === cropGeometryKey
          ? cropInteraction.lastValidPercentCrop
          : (canonicalPercentCrop ?? percentCrop);
      const commitDraft = (nextCrop: PercentCrop) => {
        lastValidPercentCrop = nextCrop;
        setCropInteraction(updateCropDraft(cropSessionKey, cropGeometryKey, nextCrop, lastValidPercentCrop));
      };

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

      if (isCropValidAfterRotation(toPixel(percentCrop), W, H, rotation)) {
        commitDraft(percentCrop);
        return;
      }

      if (!lastValidPercentCrop) {
        commitDraft(percentCrop);
        return;
      }

      if (!isCropValidAfterRotation(toPixel(lastValidPercentCrop), W, H, rotation)) {
        const lv = lastValidPercentCrop;
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
          if (isCropValidAfterRotation(toPixel(test), W, H, rotation)) {
            healed = test;
            hi = mid;
          } else {
            lo = mid;
          }
        }
        lastValidPercentCrop = healed;
      }

      const lastValid = lastValidPercentCrop;
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

            if (isCropValidAfterRotation(toPixel(testCrop), W, H, rotation)) {
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

        commitDraft(finalCrop);
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

        const isValidInitially = isCropValidAfterRotation(toPixel(targetCrop), W, H, rotation);

        if (newW <= oldW && isValidInitially) {
          commitDraft(targetCrop);
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

            if (isCropValidAfterRotation(toPixel(testCrop), W, H, rotation)) {
              bestValid = testCrop;
              low = mid;
            } else {
              high = mid;
            }
          }
          commitDraft(bestValid);
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

            if (isCropValidAfterRotation(toPixel(testCrop), W, H, rotation)) {
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

        commitDraft(finalCrop);
      }
    },
    [
      adjustments.aspectRatio,
      adjustments.orientationSteps,
      adjustments.rotation,
      canonicalPercentCrop,
      cropGeometryKey,
      cropInteraction,
      cropSessionKey,
      liveRotation,
      selectedImage,
    ],
  );

  const handleCropStart = useCallback(() => {
    if (!canonicalPercentCrop) return;
    setCropInteraction(updateCropDraft(cropSessionKey, cropGeometryKey, canonicalPercentCrop));
  }, [canonicalPercentCrop, cropGeometryKey, cropSessionKey]);

  const handleCropComplete = useCallback(
    (_crop: Crop, completedPercentCrop: PercentCrop) => {
      const pc =
        cropInteraction.kind === 'dragging' &&
        cropInteraction.sessionKey === cropSessionKey &&
        cropInteraction.geometryIdentity === cropGeometryKey
          ? cropInteraction.lastValidPercentCrop
          : completedPercentCrop;
      if (!pc.width || !pc.height || !selectedImage?.width) {
        return;
      }
      if (liveRotation !== null) {
        return;
      }

      const dimensions = getOrientedDimensions(
        selectedImage.width,
        selectedImage.height,
        adjustments.orientationSteps || 0,
      );
      const newPixelCrop = pixelCropFromPercentCrop(pc, dimensions.width, dimensions.height);

      setAdjustments((prev: Adjustments) => {
        if (JSON.stringify(newPixelCrop) !== JSON.stringify(prev.crop)) {
          return { ...prev, crop: newPixelCrop };
        }
        return prev;
      });
      setCropInteraction({ kind: 'idle' });
    },
    [
      adjustments.orientationSteps,
      cropGeometryKey,
      cropInteraction,
      cropSessionKey,
      liveRotation,
      selectedImage,
      setAdjustments,
    ],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (performance.now() < suppressDoubleClickUntilRef.current) return;
      const resolution = resolveViewerInput({
        activeTool: activeViewerTool,
        button: 0,
        focusContext: 'viewer',
        isDragging: false,
        isTemporaryHand,
        pointerCount: 1,
        pointerType: 'mouse',
        zoomed: transformStateRef.current.scale > 1.01,
      });
      if (resolution.owner !== 'viewer-pan') return;

      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      pendingZoomAnchorRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      cancelViewerMotion();
      setEditor({
        zoomMode: getEditorZoomModeForCommand({ kind: zoomMode.kind === 'fit' ? 'one-to-one' : 'fit' }, resolvedZoom),
      });
    },
    [activeViewerTool, cancelViewerMotion, isTemporaryHand, resolvedZoom, setEditor, transformStateRef, zoomMode.kind],
  );

  if (!selectedImage) {
    return null;
  }

  const isMaxZoom =
    appSettings?.useWgpuRenderer === false &&
    zoomResolutionState === 'ready' &&
    isEditorPixelInspectionZoom(resolvedZoom);

  const cursorStyle = resolveViewerInput({
    activeTool: activeViewerTool,
    button: 0,
    focusContext: 'viewer',
    isDragging: isPanningState,
    isTemporaryHand,
    pointerCount: 1,
    pointerType: 'mouse',
    zoomed: transformState.scale > 1.01,
  }).cursor;
  const currentFocalPoint: ViewportFocalPoint = focalPointRef.current ?? {
    source: 'center',
    viewportX: 0,
    viewportY: 0,
    x: 0.5,
    y: 0.5,
  };

  const previewOnlyLabel = t('editor.previewOnly.label');
  const exitPreviewLabel = t('editor.previewOnly.exit');
  const chrome = editorChromeTokens;
  const viewerChromeRegion = resolveViewerChromeRegionContract({
    isCompact: !isContiguousShell,
    isFullScreen,
  });
  const framePresentation = resolveViewerFramePresentation({
    transformScale: transformState.scale,
    zoomMode: zoomMode.kind,
  });
  const showPresentationHud = isFullScreen || lightsOutLevel !== 'off';
  const presentationHudIsActive = activeViewerTool !== 'none' || isLoaderVisible;

  return (
    <div
      className="flex-1 flex flex-col relative overflow-hidden min-h-0 bg-editor-viewer-matte"
      data-editor-viewer-layout={viewerChromeRegion.layout}
      data-viewer-lights-out={lightsOutLevel}
    >
      <div
        className={cx(
          chrome.region.viewerCommandBar,
          'overflow-visible rounded-lg border border-editor-border bg-editor-panel',
          isContiguousShell && !isFullScreen && 'rounded-none border-x-0 border-t-0 border-b',
          isFullScreen && 'hidden',
        )}
        aria-hidden={isFullScreen}
        data-editor-chrome="command-bar"
        data-editor-surrounding-chrome="true"
        data-editor-control-placement={viewerChromeRegion.persistentControlPlacement}
        data-testid="editor-toolbar-shell"
      >
        <EditorToolbar
          canRedo={canRedo}
          canUndo={canUndo}
          isAndroid={isAndroid}
          isFullScreen={isFullScreen}
          isLoading={isLoading}
          negativeLabDisabledReason={negativeLabDisabledReasonKey ? t(negativeLabDisabledReasonKey) : null}
          onBackToLibrary={onBackToLibrary}
          onOpenNegativeLab={handleOpenNegativeLab}
          onRedo={redo}
          onToggleFullScreen={handleToggleFullScreen}
          lightsOutLevel={lightsOutLevel}
          onCycleLightsOut={handleCycleLightsOut}
          onShowOriginalChange={(nextShowOriginal) => {
            dispatchCompare({ held: nextShowOriginal, type: 'set-original-held' });
          }}
          onToggleShowOriginal={toggleShowOriginal}
          onUndo={undo}
          selectedImage={selectedImage}
          compareMode={compare.mode}
          compareOrientation={compare.orientation}
          onCompareModeChange={(mode) => {
            dispatchCompare({ mode, type: 'set-mode' });
            setDefaultEditorCompareMode(mode);
          }}
          onCompareOrientationChange={(orientation) => {
            dispatchCompare({ orientation, type: 'set-orientation' });
          }}
          showOriginal={compare.isOriginalHeld || compare.mode === 'hold-original'}
        />
        {selectedImage.isOfflineSmartPreview === true && (
          <div
            className="mx-2 mb-2 rounded-md border border-editor-warning/40 bg-editor-warning-surface px-3 py-2 text-xs text-editor-warning"
            data-testid="offline-smart-preview-editor-warning"
          >
            {t('editor.offlineSmartPreview.warning')}
          </div>
        )}
      </div>

      <div
        aria-label={t('editor.accessibility.imagePreview')}
        className="relative flex flex-1 min-h-0 flex-col overflow-hidden bg-editor-viewer-matte"
        data-testid="editor-image-preview-region"
        data-editor-content-region="image"
        role="region"
      >
        <div
          className="relative min-h-0 flex-1 overflow-hidden touch-none bg-editor-viewer-matte"
          aria-busy={isLoaderVisible}
          style={{ cursor: cursorStyle }}
          role="presentation"
          onContextMenu={onContextMenu}
          ref={imageContainerRef}
          onPointerDownCapture={handlePointerDown}
          onPointerMoveCapture={handlePointerMove}
          onPointerUpCapture={handlePointerUp}
          onPointerCancelCapture={handlePointerUp}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          data-fullscreen-preview={String(isFullScreen)}
          data-editor-pointer-surface="image"
          data-editor-focal-point-source={currentFocalPoint.source}
          data-editor-focal-point-x={String(currentFocalPoint.x)}
          data-editor-focal-point-y={String(currentFocalPoint.y)}
          data-editor-layout-epoch={String(viewportLayoutEpoch)}
          data-editor-resolved-transform-scale={String(resolvedZoom.transformScale)}
          data-editor-transform-position-x={String(transformState.positionX)}
          data-editor-transform-position-y={String(transformState.positionY)}
          data-editor-transform-scale={String(transformState.scale)}
          data-editor-zoom-mode={zoomMode.kind}
          data-viewer-active-tool={activeViewerTool}
          data-viewer-gesture-state={isViewerGestureDragging ? 'dragging' : 'idle'}
          data-viewer-temporary-hand={String(isTemporaryHand)}
          data-viewer-frame-edge={String(framePresentation.edgeVisible)}
          data-viewer-frame-shadow={String(framePresentation.shadowVisible)}
          data-testid="editor-image-preview-panel"
        >
          <div
            ref={contentRef}
            className="relative w-full h-full flex items-center justify-center origin-top-left"
            data-testid="editor-image-preview-content"
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
              adjustmentGeometryRevision={adjustmentGeometryRevision}
              brushSettings={brushSettings}
              crop={crop}
              exportSoftProofRecipeId={exportSoftProofRecipeId}
              exportSoftProofTransform={exportSoftProofTransform}
              finalPreviewUrl={finalPreviewUrl}
              gamutWarningOverlay={gamutWarningOverlay}
              handleCropComplete={handleCropComplete}
              handleCropStart={handleCropStart}
              imageRenderSize={imageRenderSize}
              originalImageRenderSize={comparePaneLayout.original}
              overlayGeometry={overlayGeometry}
              interactivePatch={interactivePatch}
              isAiEditing={isAiEditing}
              isCropping={isCropping}
              isMaskControlHovered={isMaskControlHovered}
              isMasking={isMasking}
              isStraightenActive={isStraightenActive}
              isExportSoftProofEnabled={isExportSoftProofEnabled}
              isRotationActive={isRotationActive}
              isSliderDragging={isSliderDragging}
              isGamutWarningOverlayVisible={isGamutWarningOverlayVisible}
              maskOverlayUrl={maskOverlayUrl}
              maskOverlayRuntimeState={maskOverlayRuntimeState}
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
              compareMode={compare.mode}
              compareOrientation={compare.orientation}
              compareDividerPosition={compare.dividerPosition}
              compareLabelsVisible={compare.labelsVisible}
              onCompareDividerPositionChange={(position) => {
                dispatchCompare({ position, type: 'set-divider' });
              }}
              onCompareDividerReset={() => {
                dispatchCompare({ type: 'reset-divider' });
              }}
              showOriginal={compare.isOriginalHeld}
              transformedOriginalUrl={transformedOriginalUrl}
              uncroppedAdjustedPreviewUrl={uncroppedAdjustedPreviewUrl}
              updateSubMask={updateSubMaskLocal}
              isWbPickerActive={isWbPickerActive}
              lastWhiteBalancePickerReceipt={lastWhiteBalancePickerReceipt}
              onWbPicked={handleWbPicked}
              setAdjustments={setAdjustments}
              overlayRotation={overlayRotation}
              overlayMode={overlayMode}
              cursorStyle={cursorStyle}
              viewerInputState={{ activeTool: activeViewerTool, isTemporaryHand }}
              isMaxZoom={isMaxZoom}
              liveRotation={liveRotation}
              transformState={transformState}
              hasRenderedFirstFrame={hasRenderedFirstFrame}
              presentationDescriptor={presentationDescriptor}
              wgpuFrameSerial={wgpuFrameSerial}
              wgpuFailureSerial={wgpuFailureSerial}
              viewerSampleGraphRevision={viewerSampleGraphRevision}
              onViewerSamplerStateChange={setViewerSamplerState}
            />
            {activeObjectPromptState !== null && (
              <div className="pointer-events-none absolute inset-0" data-testid="object-prompt-canvas-overlay">
                {activeObjectPromptState.pointPrompts.map((point, index) => (
                  <span
                    className={cx(
                      'absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg',
                      point.label === 'foreground' ? 'border-white bg-emerald-400' : 'border-white bg-rose-500',
                    )}
                    data-object-prompt-label={point.label}
                    data-object-prompt-x={point.x}
                    data-object-prompt-y={point.y}
                    key={`${point.label}-${point.x}-${point.y}-${index}`}
                    style={(() => {
                      const viewPoint = overlayGeometry.normalizedCropToView(
                        overlayPoint<'normalized-crop'>(point.x, point.y),
                      );
                      return {
                        left: overlayGeometry.displayedImageRectInViewCssPixels.x + viewPoint.x,
                        top: overlayGeometry.displayedImageRectInViewCssPixels.y + viewPoint.y,
                      };
                    })()}
                  />
                ))}
                {activeObjectPromptState.pendingBoxAnchor !== null && (
                  <span
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-400 shadow-lg"
                    data-testid="object-prompt-pending-box-anchor"
                    style={(() => {
                      const viewPoint = overlayGeometry.normalizedCropToView(
                        overlayPoint<'normalized-crop'>(
                          activeObjectPromptState.pendingBoxAnchor.x,
                          activeObjectPromptState.pendingBoxAnchor.y,
                        ),
                      );
                      return {
                        left: overlayGeometry.displayedImageRectInViewCssPixels.x + viewPoint.x,
                        top: overlayGeometry.displayedImageRectInViewCssPixels.y + viewPoint.y,
                      };
                    })()}
                  />
                )}
                {activeObjectPromptState.boxPrompt !== null && (
                  <span
                    className="absolute border-2 border-sky-300 bg-sky-300/15 shadow-lg"
                    data-testid="object-prompt-box"
                    style={(() => {
                      const viewRect = overlayGeometry.normalizedCropRectToView(
                        overlayRect<'normalized-crop'>(
                          activeObjectPromptState.boxPrompt.x,
                          activeObjectPromptState.boxPrompt.y,
                          activeObjectPromptState.boxPrompt.width,
                          activeObjectPromptState.boxPrompt.height,
                        ),
                      );
                      return {
                        height: viewRect.height,
                        left: overlayGeometry.displayedImageRectInViewCssPixels.x + viewRect.x,
                        top: overlayGeometry.displayedImageRectInViewCssPixels.y + viewRect.y,
                        width: viewRect.width,
                      };
                    })()}
                  />
                )}
              </div>
            )}
          </div>
        </div>
        {showPresentationHud && (
          <div
            aria-label={previewOnlyLabel}
            className={cx(
              'absolute top-3 right-3 z-[140] flex items-center gap-1 rounded-md border border-editor-overlay-stroke bg-editor-overlay-surface p-1 shadow-[0_14px_34px_var(--editor-overlay-shadow)] transition-opacity duration-150',
              presentationHudIsActive ? 'opacity-100' : 'opacity-35 hover:opacity-100 focus-within:opacity-100',
            )}
            data-editor-control-placement={viewerChromeRegion.persistentControlPlacement}
            data-editor-hud-active={String(presentationHudIsActive)}
            data-testid="editor-presentation-hud"
          >
            <button
              aria-label={`Lights out: ${getViewerLightsOutLabel(lightsOutLevel)}`}
              className={cx(chrome.button.base, chrome.button.iconCompact, chrome.button.quiet, chrome.focusRing)}
              data-testid="editor-presentation-lights-out"
              onClick={lightsOutLevel === 'black' ? handleExitLightsOut : handleCycleLightsOut}
              type="button"
            >
              <MoonStar size={15} />
            </button>
            <button
              aria-label={t('editor.toolbar.tooltips.showOriginal')}
              className={cx(chrome.button.base, chrome.button.iconCompact, chrome.button.quiet, chrome.focusRing)}
              onClick={toggleShowOriginal}
              type="button"
            >
              <Eye size={15} />
            </button>
            <button
              aria-label={isFullScreen ? exitPreviewLabel : previewOnlyLabel}
              className={cx(chrome.button.base, chrome.button.iconCompact, chrome.button.quiet, chrome.focusRing)}
              data-testid="editor-preview-exit-button"
              onClick={handleToggleFullScreen}
              type="button"
            >
              {isFullScreen ? <Minimize2 size={15} /> : <Maximize size={15} />}
            </button>
          </div>
        )}
        <ViewerFooter
          activeTool={activeViewerTool}
          isFullScreen={isFullScreen}
          isRendering={isLoaderVisible}
          resolvedZoom={resolvedZoom}
          samplerState={viewerSamplerState}
          zoomResolutionState={zoomResolutionState}
        />
      </div>
    </div>
  );
}
