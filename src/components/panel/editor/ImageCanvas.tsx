import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Crop, PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import { Circle, Group, Layer, Rect, Stage } from 'react-konva';
import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import type { GamutWarningOverlayPayload } from '../../../schemas/tauriEventSchemas';
import type { EditorCompareMode, ExportSoftProofTransformState, InteractivePatch } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import type { Adjustments, AiPatch, Coord, MaskContainer } from '../../../utils/adjustments';
import {
  getRenderedPreviewWarningStatus,
  isCurrentExportSoftProofGamutWarningOverlay,
} from '../../../utils/color/runtime/gamutWarningDisplay';
import type { EditorCompareOrientation } from '../../../utils/editorCompare';
import { resolveEditorPreviewSource } from '../../../utils/editorImagePreviewSource';
import {
  captureGeometryEpoch,
  createEditorOverlayGeometry,
  type EditorOverlayGeometry,
  isGeometryEpochCurrent,
  overlayPoint,
} from '../../../utils/editorOverlayGeometry';
import { resolveEditorOverlayBlocker, resolveEditorOverlayVisibility } from '../../../utils/editorOverlayVisibility';
import {
  advanceRendererHandoff,
  createEditorPresentationDescriptor,
  createRendererHandoffState,
  type EditorPresentationDescriptor,
} from '../../../utils/editorPresentationDescriptor';
import { globalImageCache } from '../../../utils/ImageLRUCache';
import {
  InteractivePreviewUrlRegistry,
  isInteractivePreviewPatchCoherent,
} from '../../../utils/interactivePreviewPatch';
import { presentedPreviewReleaseCoordinator } from '../../../utils/presentedPreviewReleaseCoordinator';
import {
  buildViewerSamplerIdentity,
  isViewerSampleResultCurrent,
  LatestViewerSampleScheduler,
  mapViewerPointToImage,
  type ViewerSampleRequest,
  type ViewerSampleResult,
  type ViewerSampleTarget,
} from '../../../utils/viewerSampler';
import { resolveWgpuPreviewVisibility } from '../../../utils/wgpuPreviewHealth';
import {
  analyzeWhiteBalancePickerRgbaSample,
  buildWhiteBalancePickerAdjustmentCommand,
  type WhiteBalancePickerRuntimeReceipt,
} from '../../../utils/whiteBalancePicker';
import type { AppSettings, BrushSettings, SelectedImage } from '../../ui/AppProperties';
import type { OverlayMode } from '../right/color/CropPanel';
import { Mask, type SubMask, ToolType } from '../right/layers/Masks';
import { CompareOverlay } from './CompareOverlay';
import { CropOverlaySurface } from './CropOverlaySurface';
import type { CropStraightenSessionIdentity } from './cropStraightenController';
import {
  imageCanvasLayerZIndex,
  resolveCropPreviewVisibility,
  resolveDisplayedMaskUrl,
  resolveEffectiveBrushTool,
  resolveImageCanvasPointerOwner,
} from './imageCanvasContracts';
import { getEdgeFadeStyle, MaskOverlay, OptimizedBrushLine } from './MaskOverlaySurface';
import { type CanvasOverlayStatus, canvasOverlayTokens } from './overlays/canvasOverlayTokens';
import { PreviewSurface } from './PreviewSurface';
import { SvgPreviewHandoff } from './SvgPreviewHandoff';
import { useViewerFocusRetouchController } from './useViewerFocusRetouchController';
import { useViewerPickerControllers } from './useViewerPickerControllers';
import { useViewerRetouchHandlesController } from './useViewerRetouchHandlesController';
import { ViewerFocusRetouchOverlay } from './ViewerFocusRetouchOverlay';
import { ViewerPickerOverlay } from './ViewerPickerOverlay';
import { ViewerRetouchHandlesOverlay } from './ViewerRetouchHandlesOverlay';
import type { ViewerSamplerState } from './ViewerSamplerHud';
import { ViewerSurface } from './ViewerSurface';
import { createViewerAdjustmentCommandServices } from './viewerAdjustmentCommandService';
import {
  createViewerBrushCommandAdapter,
  type ViewerBrushCommandCaptureSummary,
  type ViewerBrushParameters,
} from './viewerBrushCommandAdapter';
import {
  createViewerBrushInteractionController,
  type ViewerBrushCommand,
  type ViewerBrushCurrentContext,
  type ViewerBrushLine,
  type ViewerBrushPointerSample,
} from './viewerBrushInteractionController';
import type { ViewerActiveTool } from './viewerInputResolver';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import {
  createViewerInteractionCoordinator,
  type ViewerInteractionContext,
  type ViewerInteractionTransition,
  viewerInteractionToolId,
} from './viewerInteractionCoordinator';
import { createViewerSamplerCommandService } from './viewerSamplerCommandService';
import { resolveViewerSamplerInteraction } from './viewerSamplerInteractionController';
import {
  isViewerWhiteBalanceSampleCurrent,
  resolveViewerWhiteBalanceInteraction,
} from './viewerWhiteBalanceInteractionController';

declare global {
  interface Window {
    altKeyDown?: boolean;
  }
}

interface CursorPreview {
  visible: boolean;
  x: number;
  y: number;
}

type BrushPoint = ViewerBrushLine['points'][number];
type DrawnLine = ViewerBrushLine;

interface MaskParameters extends ViewerBrushParameters {
  [key: string]: boolean | number | Array<DrawnLine> | Record<string, unknown> | undefined;
  centerX: number;
  centerY: number;
  endX: number;
  endY: number;
  flow?: number;
  isInitialDraw?: boolean;
  lines?: Array<DrawnLine>;
  radiusX: number;
  radiusY: number;
  range: number;
  rotation: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
}

interface MaskInteractionEvent {
  evt?: {
    type?: string;
  };
}

type CanvasKonvaEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>;
type CanvasMoveEvent = CanvasKonvaEvent | MouseEvent | TouchEvent;
const toMaskParameters = (parameters: SubMask['parameters']): MaskParameters => parameters as MaskParameters;

const isNonPrimaryButton = (event: CanvasKonvaEvent): boolean =>
  'button' in event.evt && typeof event.evt.button === 'number' && event.evt.button !== 0;

const isKonvaEvent = (event: CanvasMoveEvent): event is CanvasKonvaEvent => 'evt' in event && 'target' in event;

const viewerBrushPointerMetadata = (event: MouseEvent | TouchEvent | PointerEvent) => {
  const pointerType =
    'pointerType' in event && (event.pointerType === 'pen' || event.pointerType === 'touch')
      ? event.pointerType
      : 'touches' in event
        ? 'touch'
        : 'mouse';
  const pressure =
    'pressure' in event && pointerType !== 'mouse' ? Math.max(0, Math.min(1, event.pressure)) : undefined;
  const touch = 'touches' in event ? (event.touches[0] ?? event.changedTouches[0]) : undefined;
  return {
    altKey: event.altKey,
    pointerId: 'pointerId' in event ? event.pointerId : touch ? touch.identifier + 1 : 1,
    pointerType,
    pressure,
    shiftKey: event.shiftKey,
  } as const;
};

const setStageCursor = (stage: KonvaStage | null, cursor: string): void => {
  if (stage) {
    stage.container().style.cursor = cursor;
  }
};

const cssPx = (value: number | undefined): string => `${String(value ?? 0)}px`;
const cssPercent = (value: number): string => `${String(value)}%`;
const svgNumber = (value: number): string => String(value);
const canvasOverlayShadowProps = {
  shadowBlur: canvasOverlayTokens.shadow.blur,
  shadowColor: canvasOverlayTokens.shadow.color,
  shadowOpacity: canvasOverlayTokens.shadow.opacity,
} as const;
interface ImageCanvasProps {
  appSettings: AppSettings | null;
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  adjustments: Adjustments;
  adjustmentGeometryRevision?: number;
  brushSettings: BrushSettings | null;
  crop: Crop | null;
  exportSoftProofRecipeId: string | null;
  exportSoftProofTransform: ExportSoftProofTransformState | null;
  finalPreviewUrl: string | null;
  provisionalPreviewUrl?: string | null;
  gamutWarningOverlay: GamutWarningOverlayPayload | null;
  handleCropComplete: (c: Crop, cp: PercentCrop, identity: CropStraightenSessionIdentity) => void;
  handleCropStart?: () => void;
  imageSessionId: string | null;
  imageRenderSize: RenderSize;
  originalImageRenderSize?: RenderSize;
  overlayGeometry?: EditorOverlayGeometry;
  isAiEditing: boolean;
  isCropping: boolean;
  isMaskControlHovered: boolean;
  isMasking: boolean;
  isSliderDragging: boolean;
  isExportSoftProofEnabled: boolean;
  isGamutWarningOverlayVisible: boolean;
  isStraightenActive: boolean;
  isRotationActive?: boolean;
  maskOverlayUrl: string | null;
  maskOverlayRuntimeState?: { identity: string | null; status: 'current' | 'none' | 'stale-ignored' };
  onGenerateAiMask: (id: string | null, start: Coord, end: Coord) => void;
  onLiveMaskPreview?: (previewMaskDef: MaskContainer | AiPatch) => void;
  onQuickErase: (subMaskId: string | null, startPoint: Coord, endpoint: Coord) => void;
  onSelectAiSubMask: (id: string | null) => void;
  onSelectMask: (id: string | null) => void;
  onStraighten: (val: number, identity: CropStraightenSessionIdentity) => void;
  selectedImage: SelectedImage;
  setCrop: (crop: Crop, perfentCrop: PercentCrop) => void;
  setIsMaskHovered: (isHovered: boolean) => void;
  setIsMaskTouchInteracting: (isInteracting: boolean) => void;
  compareMode?: EditorCompareMode;
  compareDividerPosition?: number;
  compareLabelsVisible?: boolean;
  compareOrientation?: EditorCompareOrientation;
  onCompareDividerPositionChange?: (position: number) => void;
  onCompareDividerReset?: () => void;
  showOriginal: boolean;
  transformedOriginalUrl: string | null;
  comparisonLabel?: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  updateSubMask: (id: string | null, subMask: Partial<SubMask>) => void;
  interactivePatch?: InteractivePatch | null;
  isWbPickerActive?: boolean;
  lastWhiteBalancePickerReceipt?: WhiteBalancePickerRuntimeReceipt | null;
  onWbPicked?: (receipt: WhiteBalancePickerRuntimeReceipt, nextAdjustments: Adjustments) => void;
  onWbPreview?: (receipt: WhiteBalancePickerRuntimeReceipt, nextAdjustments: Adjustments) => void;
  onWbPreviewCancel?: () => void;
  wbPickerBaseAdjustments?: Adjustments;
  setAdjustments: (fn: (prev: Adjustments) => Adjustments) => void;
  overlayMode?: OverlayMode;
  overlayRotation?: number;
  cursorStyle: string;
  viewerInputState?: { activeTool: ViewerActiveTool; isTemporaryHand: boolean };
  isMaxZoom?: boolean;
  liveRotation?: number | null;
  transformState: { scale: number; positionX: number; positionY: number };
  hasRenderedFirstFrame: boolean;
  presentationDescriptor?: EditorPresentationDescriptor;
  wgpuFrameSerial?: number;
  wgpuFailureSerial?: number;
  viewerSampleGraphRevision?: string;
  onViewerSamplerStateChange?: (state: ViewerSamplerState) => void;
}

const ImageCanvas = memo(
  ({
    appSettings,
    activeAiPatchContainerId,
    activeAiSubMaskId,
    activeMaskContainerId,
    activeMaskId,
    adjustments,
    adjustmentGeometryRevision = 1,
    brushSettings,
    crop,
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    finalPreviewUrl,
    provisionalPreviewUrl = null,
    gamutWarningOverlay,
    handleCropComplete,
    handleCropStart = () => undefined,
    imageSessionId,
    imageRenderSize,
    originalImageRenderSize = imageRenderSize,
    overlayGeometry: providedOverlayGeometry,
    interactivePatch,
    isAiEditing,
    isCropping,
    isMaskControlHovered,
    isMasking,
    isSliderDragging,
    isExportSoftProofEnabled,
    isGamutWarningOverlayVisible,
    isStraightenActive,
    isRotationActive,
    maskOverlayUrl,
    maskOverlayRuntimeState,
    onGenerateAiMask,
    onLiveMaskPreview,
    onQuickErase,
    onSelectAiSubMask,
    onSelectMask,
    onStraighten,
    selectedImage,
    setCrop,
    setIsMaskHovered,
    setIsMaskTouchInteracting,
    compareMode = 'off',
    compareDividerPosition = 0.5,
    compareLabelsVisible = true,
    compareOrientation = 'vertical',
    onCompareDividerPositionChange = () => undefined,
    onCompareDividerReset = () => undefined,
    showOriginal,
    transformedOriginalUrl,
    comparisonLabel = null,
    uncroppedAdjustedPreviewUrl,
    updateSubMask,
    isWbPickerActive = false,
    lastWhiteBalancePickerReceipt,
    onWbPicked,
    onWbPreview,
    onWbPreviewCancel,
    wbPickerBaseAdjustments = adjustments,
    setAdjustments,
    overlayRotation,
    overlayMode,
    cursorStyle,
    viewerInputState,
    isMaxZoom,
    liveRotation,
    transformState,
    hasRenderedFirstFrame,
    presentationDescriptor: providedPresentationDescriptor,
    wgpuFrameSerial = 0,
    wgpuFailureSerial = 0,
    viewerSampleGraphRevision = 'viewer-sample-unbound',
    onViewerSamplerStateChange,
  }: ImageCanvasProps) => {
    const { t } = useTranslation();
    const setUI = useUIStore((state) => state.setUI);
    const viewerAdjustmentCommandServices = useMemo(
      () => createViewerAdjustmentCommandServices(setAdjustments),
      [setAdjustments],
    );
    const [loadedCropPreviewUrl, setLoadedCropPreviewUrl] = useState<string | null>(null);
    const cropImageRef = useRef<HTMLImageElement>(null);
    const [originalLoaded, setOriginalLoaded] = useState<boolean>(false);
    const [originalLoadFailed, setOriginalLoadFailed] = useState(false);
    const [localInitialDrawParams, setLocalInitialDrawParams] = useState<MaskParameters | null>(null);
    const [isMaskInteractionActive, setIsMaskInteractionActive] = useState(false);
    const isDrawing = useRef(false);
    const drawingStageRef = useRef<KonvaStage | null>(null);
    const dragStartPointer = useRef<Coord | null>(null);
    const pointerGeometryEpochRef = useRef<ReturnType<typeof captureGeometryEpoch> | null>(null);
    const previewBoxRef = useRef<{ start: Coord; end: Coord } | null>(null);
    const [previewBox, setPreviewBox] = useState<{ start: Coord; end: Coord } | null>(null);
    const viewerBrushController = useMemo(() => createViewerBrushInteractionController(), []);
    const viewerBrushCommands = useMemo(
      () => createViewerBrushCommandAdapter((id, patch) => viewerAdjustmentCommandServices.updateSubMask(id, patch)),
      [viewerAdjustmentCommandServices],
    );
    const viewerInteractionCoordinator = useMemo(() => createViewerInteractionCoordinator(), []);
    const viewerInteractionTransitionRef = useRef<ViewerInteractionTransition | null>(null);
    const [viewerInputOwnerState, setViewerInputOwnerState] = useState<'active-tool' | 'blocked' | 'viewer-pan' | null>(
      null,
    );
    useEffect(
      () => () => {
        viewerInteractionCoordinator.dispose();
      },
      [viewerInteractionCoordinator],
    );

    const [cursorPreview, setCursorPreview] = useState<CursorPreview>({ x: 0, y: 0, visible: false });
    const [liveBrushLine, setLiveBrushLine] = useState<DrawnLine | null>(null);
    const overlayGeometry = useMemo(
      () =>
        providedOverlayGeometry ??
        createEditorOverlayGeometry({
          crop: adjustments.crop,
          devicePixelRatio: 1,
          geometryEpoch: 1,
          orientationSteps: adjustments.orientationSteps ?? 0,
          renderSize: imageRenderSize,
          rotationDegrees: liveRotation ?? adjustments.rotation ?? 0,
          semanticZoom: {
            cssPercent: imageRenderSize.scale * 100,
            devicePixelsPerImagePixel: imageRenderSize.scale,
            displayPercent: Math.round(imageRenderSize.scale * 100),
            imagePixelsPerCssPixel: 1 / Math.max(imageRenderSize.scale, Number.EPSILON),
            imagePixelsPerDevicePixel: 1 / Math.max(imageRenderSize.scale, Number.EPSILON),
            mode: { kind: 'fit' },
            requiredPreviewResolution: Math.max(imageRenderSize.width, imageRenderSize.height),
            transformScale: transformState.scale,
          },
          sourceSize: { height: selectedImage.height, width: selectedImage.width },
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
        imageRenderSize,
        liveRotation,
        providedOverlayGeometry,
        selectedImage.height,
        selectedImage.width,
        transformState,
      ],
    );

    const previewSource = resolveEditorPreviewSource({
      finalPreviewUrl,
      isReady: selectedImage.isReady,
      provisionalPreviewUrl,
      thumbnailUrl: selectedImage.thumbnailUrl,
    });
    const presentationDescriptor = useMemo(
      () =>
        providedPresentationDescriptor ??
        createEditorPresentationDescriptor({
          colorTransformIdentity: 'fixture-display:v1',
          compareIdentity: JSON.stringify({ compareDividerPosition, compareMode, compareOrientation, showOriginal }),
          geometry: overlayGeometry,
          graphRevision: viewerSampleGraphRevision,
          overlayIdentity: JSON.stringify({ mask: maskOverlayRuntimeState?.identity ?? null, overlayMode }),
          proofTransformIdentity: JSON.stringify({
            enabled: isExportSoftProofEnabled,
            recipeId: exportSoftProofRecipeId,
          }),
          quality: isSliderDragging ? 'interactive' : 'settled',
          sourceIdentity: selectedImage.path,
          textureSize: { height: imageRenderSize.height, width: imageRenderSize.width },
        }),
      [
        compareDividerPosition,
        compareMode,
        compareOrientation,
        exportSoftProofRecipeId,
        imageRenderSize.height,
        imageRenderSize.width,
        isExportSoftProofEnabled,
        isSliderDragging,
        maskOverlayRuntimeState?.identity,
        overlayGeometry,
        overlayMode,
        providedPresentationDescriptor,
        selectedImage.path,
        showOriginal,
        viewerSampleGraphRevision,
      ],
    );
    const cropStraightenSession = useMemo<CropStraightenSessionIdentity | null>(
      () =>
        isCropping && imageSessionId !== null
          ? {
              geometryEpoch: overlayGeometry.geometryEpoch,
              imageSessionId,
              operationGeneration: adjustmentGeometryRevision,
              sourceIdentity: presentationDescriptor.sourceIdentity,
              sourceRevision: presentationDescriptor.graphRevision,
              tool: isStraightenActive ? 'straighten' : 'crop',
            }
          : null,
      [
        adjustmentGeometryRevision,
        imageSessionId,
        isCropping,
        isStraightenActive,
        overlayGeometry.geometryEpoch,
        presentationDescriptor.graphRevision,
        presentationDescriptor.sourceIdentity,
        selectedImage.path,
      ],
    );
    const pickerControllers = useViewerPickerControllers({
      adjustments,
      geometry: overlayGeometry,
      presentation: presentationDescriptor,
      setAdjustments,
    });
    const focusRetouchController = useViewerFocusRetouchController({
      geometry: overlayGeometry,
      imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
      presentation: presentationDescriptor,
    });

    const [interactivePreviewUrlRegistry] = useState(() => new InteractivePreviewUrlRegistry());
    const releasePresentedPreviewUrl = useCallback((url: string) => {
      // The cache may retain an outgoing surface for instant A -> B -> A reuse.
      // Its eviction path owns revocation until get() transfers ownership back.
      if (!globalImageCache.isProtected(url)) URL.revokeObjectURL(url);
    }, []);
    const acknowledgeBasePreviewUrl = useCallback(
      (url: string) => {
        presentedPreviewReleaseCoordinator.acknowledge('base', url, releasePresentedPreviewUrl);
      },
      [releasePresentedPreviewUrl],
    );
    const acknowledgeOriginalPreviewUrl = useCallback(
      (url: string) => {
        presentedPreviewReleaseCoordinator.acknowledge('original', url, releasePresentedPreviewUrl);
      },
      [releasePresentedPreviewUrl],
    );
    useEffect(
      () => () => {
        presentedPreviewReleaseCoordinator.cancel(releasePresentedPreviewUrl);
      },
      [releasePresentedPreviewUrl],
    );

    const retainPreviewLayerUrl = useCallback(
      (owner: string, url: string) => {
        interactivePreviewUrlRegistry.claim(owner, url);
      },
      [interactivePreviewUrlRegistry],
    );

    const releasePreviewLayerUrl = useCallback(
      (owner: string, url: string) => {
        if (!interactivePreviewUrlRegistry.release(owner, url)) return;
        if (
          url === finalPreviewUrl ||
          url === interactivePatch?.url ||
          url === selectedImage.thumbnailUrl ||
          globalImageCache.isProtected(url)
        ) {
          return;
        }
        URL.revokeObjectURL(url);
      },
      [finalPreviewUrl, interactivePatch?.url, interactivePreviewUrlRegistry, selectedImage.thumbnailUrl],
    );

    const canonicalBrushTool = brushSettings?.tool ?? ToolType.Brush;
    const [isAltPressed, setIsAltPressed] = useState(false);
    const [lastBrushCommandCapture, setLastBrushCommandCapture] = useState<ViewerBrushCommandCaptureSummary | null>(
      null,
    );

    const rendererHandoffRef = useRef(createRendererHandoffState(presentationDescriptor, wgpuFrameSerial));
    const handledWgpuFailureSerialRef = useRef(wgpuFailureSerial);
    const hasNewWgpuFailure = wgpuFailureSerial > handledWgpuFailureSerialRef.current;
    handledWgpuFailureSerialRef.current = wgpuFailureSerial;
    rendererHandoffRef.current = advanceRendererHandoff({
      descriptor: presentationDescriptor,
      failed: hasNewWgpuFailure,
      state: rendererHandoffRef.current,
      useWgpuRenderer: appSettings?.useWgpuRenderer === true,
      wgpuFrameSerial,
    });
    const rendererHandoff = rendererHandoffRef.current;
    const wgpuPreviewVisibility = resolveWgpuPreviewVisibility({
      currentFrameHealth: rendererHandoff.committedBackend === 'wgpu' ? 'fresh' : null,
      hasRenderedFirstFrame,
      previewSource,
      selectedImageIsReady: selectedImage.isReady,
      useWgpuRenderer: appSettings?.useWgpuRenderer,
    });
    const isWgpuActive = wgpuPreviewVisibility.shouldHideCpuPreview;
    const paddingX = imageRenderSize.width * 0.5;
    const paddingY = imageRenderSize.height * 0.5;

    const stageLeft = imageRenderSize.offsetX - paddingX;
    const stageTop = imageRenderSize.offsetY - paddingY;
    const stageWidth = imageRenderSize.width > 0 ? imageRenderSize.width + paddingX * 2 : 0;
    const stageHeight = imageRenderSize.height > 0 ? imageRenderSize.height + paddingY * 2 : 0;

    const groupOffsetX = paddingX;
    const groupOffsetY = paddingY;

    const [settledScale, setSettledScale] = useState(transformState.scale);
    useEffect(() => {
      const timer = setTimeout(() => {
        setSettledScale(transformState.scale);
      }, 150);
      return () => {
        clearTimeout(timer);
      };
    }, [transformState.scale]);

    const maxDimension = Math.max(stageWidth, stageHeight, 1);
    const maxSafeScale = Math.max(1, Math.min(settledScale, 4092 / maxDimension));

    const getCanvasPointer = useCallback(
      (stage: KonvaStage | null): Coord | null => {
        if (!stage) return null;
        const pos = stage.getPointerPosition();
        if (!pos) return null;
        return {
          x: pos.x / maxSafeScale - groupOffsetX,
          y: pos.y / maxSafeScale - groupOffsetY,
        };
      },
      [groupOffsetX, groupOffsetY, maxSafeScale],
    );

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Alt') {
          e.preventDefault();
          window.altKeyDown = true;
          setIsAltPressed(true);
        }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key === 'Alt') {
          e.preventDefault();
          window.altKeyDown = false;
          setIsAltPressed(false);
        }
      };
      const handleBlur = () => {
        window.altKeyDown = false;
        setIsAltPressed(false);
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('blur', handleBlur);

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('blur', handleBlur);
        delete window.altKeyDown;
      };
    }, []);

    const activeContainer = useMemo(() => {
      if (isMasking) {
        return adjustments.masks.find((c: MaskContainer) => c.id === activeMaskContainerId);
      }
      if (isAiEditing) {
        return adjustments.aiPatches.find((p: AiPatch) => p.id === activeAiPatchContainerId);
      }
      return null;
    }, [
      adjustments.masks,
      adjustments.aiPatches,
      activeMaskContainerId,
      activeAiPatchContainerId,
      isMasking,
      isAiEditing,
    ]);

    const activeRetouchLayer = useMemo(() => {
      if (!activeMaskContainerId) return null;
      const layer = adjustments.masks.find((mask: MaskContainer) => mask.id === activeMaskContainerId);
      return layer?.retouchCloneSource === undefined ? null : layer;
    }, [activeMaskContainerId, adjustments.masks]);

    const activeRetouchSource = activeRetouchLayer?.retouchCloneSource ?? null;

    const activeRemoveLayer = useMemo(() => {
      if (!activeMaskContainerId) return null;
      const layer = adjustments.masks.find((mask: MaskContainer) => mask.id === activeMaskContainerId);
      return layer?.retouchRemoveSource === undefined ? null : layer;
    }, [activeMaskContainerId, adjustments.masks]);

    const activeRemoveSource = activeRemoveLayer?.retouchRemoveSource ?? null;
    const activeRemoveTargetSubMask = useMemo(() => {
      if (!activeRemoveLayer || !activeRemoveSource) return null;
      return activeRemoveLayer.subMasks.find((subMask) => subMask.id === activeRemoveSource.targetMaskId) ?? null;
    }, [activeRemoveLayer, activeRemoveSource]);

    const activeSubMask = useMemo(() => {
      if (!activeContainer) {
        return null;
      }
      if (isMasking) {
        return activeContainer.subMasks.find((m: SubMask) => m.id === activeMaskId);
      }
      if (isAiEditing) {
        return activeContainer.subMasks.find((m: SubMask) => m.id === activeAiSubMaskId);
      }
      return null;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking, isAiEditing]);

    const effectiveImageDimensions = overlayGeometry.orientedSize;
    const effectiveZoomScale = transformState.scale > 0 ? transformState.scale : 1;
    const brushStageSize = (brushSettings?.size ?? 0) / effectiveZoomScale;
    const brushImageSpaceSize = brushStageSize / Math.max(overlayGeometry.viewRadiusFromCrop(1), Number.EPSILON);
    const isBrushActive =
      (isMasking || isAiEditing) && (activeSubMask?.type === Mask.Brush || activeSubMask?.type === Mask.Flow);
    const activeSubMaskParameters = useMemo(
      () => (activeSubMask ? toMaskParameters(activeSubMask.parameters) : null),
      [activeSubMask],
    );
    const activeLineFlow = activeSubMask?.type === Mask.Flow ? (activeSubMaskParameters?.flow ?? 10) : undefined;
    const getImageSpacePoint = useCallback(
      (point: BrushPoint): BrushPoint => {
        const orientedPoint = overlayGeometry.cropToOriented(
          overlayGeometry.viewToCrop(overlayPoint<'view-css-pixels'>(point.x, point.y)),
        );

        return {
          ...(point.pressure === undefined ? {} : { pressure: point.pressure }),
          x: orientedPoint.x,
          y: orientedPoint.y,
        };
      },
      [overlayGeometry],
    );
    const activeBrushMaskId = isMasking ? activeMaskId : activeAiSubMaskId;
    const viewerBrushContext: ViewerBrushCurrentContext = {
      active: isBrushActive && activeBrushMaskId !== null,
      geometryEpoch: overlayGeometry.geometryEpoch,
      imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
      maskId: activeBrushMaskId ?? 'brush:none',
      sourceRevision: presentationDescriptor.graphRevision,
      toolId: 'brush',
    };
    const createBrushPointerSample = useCallback(
      (point: Coord, event: MouseEvent | TouchEvent | PointerEvent): ViewerBrushPointerSample => {
        const metadata = viewerBrushPointerMetadata(event);
        const viewPoint: BrushPoint = {
          ...(metadata.pressure === undefined ? {} : { pressure: metadata.pressure }),
          ...point,
        };
        return { ...metadata, imagePoint: getImageSpacePoint(viewPoint), viewPoint };
      },
      [getImageSpacePoint],
    );
    const publishBrushOverlay = useCallback(() => {
      const line = viewerBrushController.overlays()[0]?.imageLine ?? null;
      setLiveBrushLine(line);
      if (line === null || !onLiveMaskPreview || !activeContainer || !activeSubMask) return;
      const previewSubMask = {
        ...activeSubMask,
        parameters: {
          ...activeSubMaskParameters,
          lines: [...(activeSubMaskParameters?.lines ?? []), line],
        },
      };
      onLiveMaskPreview({
        ...activeContainer,
        subMasks: activeContainer.subMasks.map((subMask: SubMask) =>
          subMask.id === activeSubMask.id ? previewSubMask : subMask,
        ),
      });
    }, [activeContainer, activeSubMask, activeSubMaskParameters, onLiveMaskPreview, viewerBrushController]);
    const executeBrushCommands = useCallback(
      (commands: readonly ViewerBrushCommand[]) => {
        for (const command of commands) {
          if (command.kind !== 'commit' || !activeSubMask || !activeSubMaskParameters) continue;
          const result = viewerBrushCommands.commit(command, {
            current: viewerBrushContext,
            imagePath: selectedImage.path,
            imageSize: effectiveImageDimensions,
            parameters: activeSubMaskParameters,
            subMask: activeSubMask,
          });
          if (result !== null) setLastBrushCommandCapture(result.summary);
        }
        if (commands.some((command) => command.kind === 'cancel' || command.kind === 'commit')) {
          drawingStageRef.current = null;
        }
        publishBrushOverlay();
      },
      [
        activeSubMask,
        activeSubMaskParameters,
        effectiveImageDimensions,
        publishBrushOverlay,
        selectedImage.path,
        viewerBrushCommands,
        viewerBrushContext,
      ],
    );
    useEffect(() => {
      const commands = viewerBrushController.synchronize(viewerBrushContext);
      if (activeSubMask && activeSubMaskParameters) {
        viewerBrushCommands.synchronize({
          current: viewerBrushContext,
          imagePath: selectedImage.path,
          imageSize: effectiveImageDimensions,
          parameters: activeSubMaskParameters,
          subMask: activeSubMask,
        });
      }
      if (commands.length > 0) publishBrushOverlay();
    }, [
      activeSubMask,
      activeSubMaskParameters,
      effectiveImageDimensions,
      publishBrushOverlay,
      selectedImage.path,
      viewerBrushCommands,
      viewerBrushContext,
      viewerBrushController,
    ]);
    useEffect(
      () => () => {
        viewerBrushController.cancel('unmount');
      },
      [viewerBrushController],
    );
    const brushCursorPreview = useMemo(() => {
      const radius = Math.max(0.1, brushStageSize / 2);
      const feather = Math.max(0, Math.min(1, (brushSettings?.feather ?? 0) / 100));
      const subMaskOpacity = Math.max(0, Math.min(1, (activeSubMask?.opacity ?? 100) / 100));
      const containerOpacity =
        activeContainer && 'opacity' in activeContainer && typeof activeContainer.opacity === 'number'
          ? Math.max(0, Math.min(1, activeContainer.opacity / 100))
          : 1;
      const flowOpacity =
        activeSubMask?.type === Mask.Flow ? Math.max(0, Math.min(1, (activeLineFlow ?? 10) / 100)) : 1;
      const alpha = Math.max(0, Math.min(0.5, 0.5 * subMaskOpacity * containerOpacity * flowOpacity));

      const isEraser =
        resolveEffectiveBrushTool(canonicalBrushTool === ToolType.Eraser ? 'eraser' : 'brush', isAltPressed) ===
        'eraser';

      const strokeColor = isEraser
        ? (a: number) => `rgba(244, 63, 94, ${a.toFixed(3)})`
        : (a: number) => `rgba(14, 165, 233, ${a.toFixed(3)})`;

      if (feather <= 0.001) {
        return {
          fill: strokeColor(alpha),
          radius,
        };
      }

      const innerStop = 1 - feather;
      const colorStops: Array<number | string> = [0, strokeColor(alpha)];

      if (innerStop > 0.001) {
        colorStops.push(innerStop, strokeColor(alpha));
      }

      for (const t of [0.25, 0.5, 0.75, 1]) {
        const smoothstep = t * t * (3 - 2 * t);
        const intensity = 1 - smoothstep;
        colorStops.push(Math.min(1, innerStop + feather * t), strokeColor(alpha * intensity));
      }

      return {
        colorStops,
        radius,
      };
    }, [
      activeContainer,
      activeSubMask?.opacity,
      activeLineFlow,
      activeSubMask?.type,
      brushSettings?.feather,
      brushStageSize,
      canonicalBrushTool,
      isAltPressed,
    ]);
    const isAiSubjectActive =
      (isMasking || isAiEditing) &&
      (activeSubMask?.type === Mask.AiSubject || activeSubMask?.type === Mask.QuickEraser);
    const isParametricActive =
      (isMasking || isAiEditing) && (activeSubMask?.type === Mask.Color || activeSubMask?.type === Mask.Luminance);
    const isInitialDrawing = (isMasking || isAiEditing) && activeSubMaskParameters?.isInitialDraw === true;

    const isToolActive = isBrushActive || isAiSubjectActive || isInitialDrawing || isParametricActive;
    const effectiveMaskInteractionActive = (isMasking || isAiEditing) && isMaskInteractionActive;
    const samplerSuppressed =
      isCropping ||
      isMasking ||
      isAiEditing ||
      isSliderDragging ||
      isStraightenActive ||
      Boolean(isRotationActive) ||
      isWbPickerActive ||
      pickerControllers.activeTool !== null ||
      effectiveMaskInteractionActive ||
      isToolActive ||
      (viewerInputState?.activeTool !== undefined && viewerInputState.activeTool !== 'none');
    interface LocalViewerSamplerState {
      locked: boolean;
      result: ViewerSampleResult | null;
      target: ViewerSampleTarget;
    }
    const initialViewerSamplerState: LocalViewerSamplerState = {
      locked: false,
      result: null,
      target: isExportSoftProofEnabled ? 'softProof' : 'edited',
    };
    const [viewerSampler, setViewerSampler] = useState(initialViewerSamplerState);
    const viewerSamplerRef = useRef(viewerSampler);
    const whiteBalancePreviewIdentityRef = useRef(finalPreviewUrl);
    const whiteBalancePickerActiveRef = useRef(isWbPickerActive);
    const whiteBalanceSampleSequenceRef = useRef(0);
    const whiteBalanceSourceIdentityRef = useRef(selectedImage.path);
    const whiteBalanceGeometryEpochRef = useRef(overlayGeometry.geometryEpoch);
    const lastWhiteBalanceHoverSampleAtRef = useRef(0);
    whiteBalancePreviewIdentityRef.current = finalPreviewUrl;
    whiteBalancePickerActiveRef.current = isWbPickerActive;
    whiteBalanceSourceIdentityRef.current = selectedImage.path;
    whiteBalanceGeometryEpochRef.current = overlayGeometry.geometryEpoch;
    viewerSamplerRef.current = viewerSampler;
    const transitionViewerSamplerRef = useRef<
      (transition: (current: LocalViewerSamplerState) => LocalViewerSamplerState) => void
    >(() => undefined);
    const handleToggleViewerSampleLock = useCallback(() => {
      transitionViewerSamplerRef.current((current) => ({ ...current, locked: !current.locked }));
    }, []);
    const transitionViewerSampler = useCallback(
      (transition: (current: LocalViewerSamplerState) => LocalViewerSamplerState) => {
        const next = transition(viewerSamplerRef.current);
        viewerSamplerRef.current = next;
        setViewerSampler(next);
        onViewerSamplerStateChange?.({
          locked: next.locked,
          onToggleLock: handleToggleViewerSampleLock,
          result: next.result,
          suppressed: samplerSuppressed,
          target: next.target,
        });
      },
      [handleToggleViewerSampleLock, onViewerSamplerStateChange, samplerSuppressed],
    );
    transitionViewerSamplerRef.current = transitionViewerSampler;
    const viewerSampleLocked = viewerSampler.locked;
    const viewerSamplerIdentity = buildViewerSamplerIdentity({
      backend: wgpuPreviewVisibility.previewBackend,
      compareDividerPosition,
      compareMode,
      compareOrientation,
      geometryEpoch: overlayGeometry.geometryEpoch,
      graphRevision: viewerSampleGraphRevision,
      imageIdentity: selectedImage.path,
      proofRecipeId: exportSoftProofRecipeId ?? null,
      softProofEnabled: isExportSoftProofEnabled,
    });

    const latestViewerSampleRequestRef = useRef<ViewerSampleRequest | null>(null);
    const viewerSamplerCommandService = useMemo(() => createViewerSamplerCommandService(), []);
    const executeViewerSampleRef = useRef<(request: ViewerSampleRequest) => Promise<void>>(async () => {});
    const viewerSampleSchedulerRef = useRef<LatestViewerSampleScheduler | null>(null);
    if (!viewerSampleSchedulerRef.current) {
      viewerSampleSchedulerRef.current = new LatestViewerSampleScheduler((request) =>
        executeViewerSampleRef.current(request),
      );
    }
    executeViewerSampleRef.current = async (request) => {
      try {
        const result = await viewerSamplerCommandService.sample(request);
        if (isViewerSampleResultCurrent(result, latestViewerSampleRequestRef.current)) {
          transitionViewerSampler((current) => ({ ...current, result }));
        }
      } catch {
        if (latestViewerSampleRequestRef.current?.requestIdentity === request.requestIdentity) {
          transitionViewerSampler((current) => ({
            ...current,
            result: {
              status: 'unavailable',
              requestIdentity: request.requestIdentity,
              reason: 'frameUnavailable',
              spaceLabel: 'Unavailable',
            },
          }));
        }
      }
    };

    useEffect(
      () => () => {
        viewerSampleSchedulerRef.current?.dispose();
      },
      [],
    );

    useEffect(() => {
      latestViewerSampleRequestRef.current = null;
      viewerSampleSchedulerRef.current?.clear();
      // Locks pin interaction, not pixels: any render identity change invalidates
      // the result so a locked footer can never describe another frame.
      transitionViewerSampler((current) => ({ ...current, result: null }));
    }, [samplerSuppressed, transitionViewerSampler, viewerSamplerIdentity]);

    const handleViewerSamplerPointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (viewerSampleLocked || samplerSuppressed || event.pointerType === 'touch') return;
        const surface = event.currentTarget;
        const rect = surface.getBoundingClientRect();
        const resolved = resolveViewerSamplerInteraction(
          {
            compareDividerPosition,
            compareMode,
            compareOrientation,
            displayedImageRect: overlayGeometry.displayedImageRectInViewCssPixels,
            editedRenderSize: imageRenderSize,
            geometryEpoch: overlayGeometry.geometryEpoch,
            graphRevision: viewerSampleGraphRevision,
            imageIdentity: selectedImage.path,
            originalRenderSize: originalImageRenderSize,
            proofEnabled: isExportSoftProofEnabled,
            sourceImageSize: { height: selectedImage.height, width: selectedImage.width },
          },
          { altKey: event.altKey, clientX: event.clientX, clientY: event.clientY },
          {
            height: rect.height,
            layoutHeight: surface.offsetHeight,
            layoutWidth: surface.offsetWidth,
            width: rect.width,
            x: rect.x,
            y: rect.y,
          },
        );
        if (resolved === null) {
          latestViewerSampleRequestRef.current = null;
          viewerSampleSchedulerRef.current?.clear();
          transitionViewerSampler((current) => ({ ...current, result: null }));
          return;
        }
        transitionViewerSampler((current) => ({ ...current, target: resolved.target }));
        latestViewerSampleRequestRef.current = resolved.request;
        viewerSampleSchedulerRef.current?.schedule(resolved.request);
      },
      [
        compareMode,
        compareDividerPosition,
        compareOrientation,
        imageRenderSize,
        isExportSoftProofEnabled,
        originalImageRenderSize,
        overlayGeometry,
        samplerSuppressed,
        selectedImage.height,
        selectedImage.path,
        selectedImage.width,
        viewerSampleGraphRevision,
        viewerSampleLocked,
      ],
    );

    const handleViewerSamplerPointerLeave = useCallback(() => {
      if (viewerSampleLocked) return;
      latestViewerSampleRequestRef.current = null;
      viewerSampleSchedulerRef.current?.clear();
      transitionViewerSampler((current) => ({ ...current, result: null }));
    }, [viewerSampleLocked]);

    const displayedMaskUrl = resolveDisplayedMaskUrl({ isAiEditing, isMasking, maskOverlayUrl });

    const finishCanvasToolInteraction = useCallback((_reason: string) => {
      isDrawing.current = false;
      drawingStageRef.current = null;
      dragStartPointer.current = null;
      pointerGeometryEpochRef.current = null;
      setPreviewBox(null);
      previewBoxRef.current = null;
      setLocalInitialDrawParams(null);
      setIsMaskInteractionActive(false);
      setCursorPreview((preview) => ({ ...preview, visible: false }));
    }, []);

    useEffect(
      () => () => finishCanvasToolInteraction('tool-or-session-exit'),
      [
        activeAiSubMaskId,
        activeMaskId,
        finishCanvasToolInteraction,
        isAiEditing,
        isMasking,
        isToolActive,
        overlayGeometry.geometryEpoch,
        selectedImage.path,
      ],
    );

    useEffect(() => {
      const clearTouchInteraction = () => {
        setIsMaskTouchInteracting(false);
      };

      window.addEventListener('touchend', clearTouchInteraction);
      window.addEventListener('touchcancel', clearTouchInteraction);

      return () => {
        window.removeEventListener('touchend', clearTouchInteraction);
        window.removeEventListener('touchcancel', clearTouchInteraction);
      };
    }, [setIsMaskTouchInteracting]);

    const sortedSubMasks = useMemo(() => {
      if (!activeContainer) {
        return [];
      }
      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
      const selectedMask = activeContainer.subMasks.find((m: SubMask) => m.id === activeId);
      const otherMasks = activeContainer.subMasks.filter((m: SubMask) => m.id !== activeId);
      return selectedMask ? [...otherMasks, selectedMask] : activeContainer.subMasks;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking]);

    const handleWbSample = useCallback(
      (e: CanvasKonvaEvent, commit: boolean) => {
        if (!isWbPickerActive || !finalPreviewUrl || (commit ? !onWbPicked : !onWbPreview)) return;

        const stage = e.target.getStage();
        const pointerPos = getCanvasPointer(stage);
        if (!pointerPos) return;

        const cropPoint = overlayGeometry.viewToCrop(overlayPoint<'view-css-pixels'>(pointerPos.x, pointerPos.y));
        const imgLogicalWidth = overlayGeometry.cropRectInOrientedPixels.width;
        const imgLogicalHeight = overlayGeometry.cropRectInOrientedPixels.height;
        const sampleGeometryEpoch = captureGeometryEpoch(overlayGeometry);
        const sampleSequence = ++whiteBalanceSampleSequenceRef.current;
        const interaction = resolveViewerWhiteBalanceInteraction(
          {
            cropSize: { height: imgLogicalHeight, width: imgLogicalWidth },
            geometryEpoch: sampleGeometryEpoch.geometryEpoch,
            previewIdentity: finalPreviewUrl,
            sourceIdentity: selectedImage.path,
          },
          { x: cropPoint.x, y: cropPoint.y },
          sampleSequence,
        );
        if (interaction === null) return;
        const { x, y } = interaction.imagePoint;

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = finalPreviewUrl;

        img.onload = () => {
          if (
            !isViewerWhiteBalanceSampleCurrent(
              interaction.identity,
              {
                geometryEpoch: whiteBalanceGeometryEpochRef.current,
                previewIdentity: whiteBalancePreviewIdentityRef.current ?? '',
                sequence: whiteBalanceSampleSequenceRef.current,
                sourceIdentity: whiteBalanceSourceIdentityRef.current,
              },
              whiteBalancePickerActiveRef.current,
            ) ||
            !isGeometryEpochCurrent(sampleGeometryEpoch, overlayGeometry)
          )
            return;
          const radius = 5;
          const side = radius * 2 + 1;

          const canvas = document.createElement('canvas');
          canvas.width = side;
          canvas.height = side;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;

          const scaleX = img.width / imgLogicalWidth;
          const scaleY = img.height / imgLogicalHeight;
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);

          const startX = Math.max(0, srcX - radius);
          const startY = Math.max(0, srcY - radius);
          const endX = Math.min(img.width, srcX + radius + 1);
          const endY = Math.min(img.height, srcY + radius + 1);
          const sw = endX - startX;
          const sh = endY - startY;

          if (sw <= 0 || sh <= 0) return;

          ctx.drawImage(img, startX, startY, sw, sh, 0, 0, sw, sh);

          const patch = analyzeWhiteBalancePickerRgbaSample(ctx.getImageData(0, 0, sw, sh).data);
          if (!patch || whiteBalancePreviewIdentityRef.current !== finalPreviewUrl) return;
          if (patch.rejectedClippedPixels / patch.patchPixelCount > 0.1 || patch.spatialVariance > 0.025) return;

          const command = buildWhiteBalancePickerAdjustmentCommand({
            ...patch,
            coordinates: {
              imageX: x,
              imageY: y,
              previewPixelX: srcX,
              previewPixelY: srcY,
            },
            currentAdjustments: wbPickerBaseAdjustments,
            currentPreviewIdentity: whiteBalancePreviewIdentityRef.current,
            previewIdentity: finalPreviewUrl,
            selectedImagePath: selectedImage.path,
          });

          if (commit) onWbPicked?.(command.receipt, command.nextAdjustments);
          else onWbPreview?.(command.receipt, command.nextAdjustments);
        };
      },
      [
        finalPreviewUrl,
        isWbPickerActive,
        onWbPicked,
        onWbPreview,
        overlayGeometry,
        selectedImage.path,
        wbPickerBaseAdjustments,
        getCanvasPointer,
      ],
    );

    const handleWbClick = useCallback((event: CanvasKonvaEvent) => handleWbSample(event, true), [handleWbSample]);

    const handleWbHover = useCallback(
      (event: CanvasKonvaEvent) => {
        const now = performance.now();
        if (now - lastWhiteBalanceHoverSampleAtRef.current < 150) return;
        lastWhiteBalanceHoverSampleAtRef.current = now;
        handleWbSample(event, false);
      },
      [handleWbSample],
    );

    const handleStart = useCallback(
      (e: CanvasKonvaEvent) => {
        if (isNonPrimaryButton(e)) {
          return;
        }

        if (e.evt.cancelable) e.evt.preventDefault();
        pointerGeometryEpochRef.current = captureGeometryEpoch(overlayGeometry);

        if (isWbPickerActive) {
          handleWbClick(e);
          return;
        }

        if (isParametricActive) {
          if (!activeSubMaskParameters) return;
          const pos = getCanvasPointer(e.target.getStage());
          if (!pos) return;

          const imagePoint = getImageSpacePoint(pos);
          const x = imagePoint.x;
          const y = imagePoint.y;

          const newParams: MaskParameters = { ...activeSubMaskParameters };
          newParams.targetX = x;
          newParams.targetY = y;
          newParams.rotation = adjustments.rotation || 0;
          newParams['flipHorizontal'] = adjustments.flipHorizontal || false;
          newParams['flipVertical'] = adjustments.flipVertical || false;
          newParams['orientationSteps'] = adjustments.orientationSteps || 0;
          delete newParams.isInitialDraw;

          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
          viewerAdjustmentCommandServices.updateSubMask(activeId, { parameters: newParams });
          return;
        }

        if (isInitialDrawing) {
          if (!activeSubMask) return;
          isDrawing.current = true;
          drawingStageRef.current = e.target.getStage();
          const pos = getCanvasPointer(e.target.getStage());
          if (!pos) return;

          const imagePoint = getImageSpacePoint(pos);
          const x = imagePoint.x;
          const y = imagePoint.y;

          dragStartPointer.current = { x, y };

          let initialParams: MaskParameters = { ...toMaskParameters(activeSubMask.parameters) };

          if (activeSubMask.type === Mask.Radial) {
            initialParams = {
              ...initialParams,
              centerX: x,
              centerY: y,
              radiusX: 0,
              radiusY: 0,
              rotation: 0,
            };
          } else if (activeSubMask.type === Mask.Linear) {
            initialParams = {
              ...initialParams,
              startX: x,
              startY: y,
              endX: x,
              endY: y,
              range: 0,
            };
          }

          setLocalInitialDrawParams(initialParams);
          return;
        }

        if (isToolActive) {
          const stage = e.target.getStage();
          const pos = getCanvasPointer(stage);
          if (!pos) {
            isDrawing.current = false;
            setPreviewBox(null);
            previewBoxRef.current = null;
            return;
          }

          if (isAiSubjectActive) {
            isDrawing.current = true;
            drawingStageRef.current = stage;
            const newBox = { start: pos, end: pos };
            previewBoxRef.current = newBox;
            setPreviewBox(newBox);
            return;
          }
          if (isBrushActive) {
            drawingStageRef.current = stage;
            executeBrushCommands(
              viewerBrushController.begin(viewerBrushContext, createBrushPointerSample(pos, e.evt), {
                canonicalTool: canonicalBrushTool === ToolType.Eraser ? 'eraser' : 'brush',
                feather: brushSettings?.feather ? brushSettings.feather / 100 : 0,
                ...(activeLineFlow === undefined ? {} : { flow: activeLineFlow }),
                imageSpaceSize: brushImageSpaceSize,
              }),
            );
            return;
          }
        } else {
          if (e.target === e.target.getStage()) {
            if (isMasking) {
              onSelectMask(null);
            }
            if (isAiEditing) {
              onSelectAiSubMask(null);
            }
          }
        }
      },
      [
        isWbPickerActive,
        handleWbClick,
        isInitialDrawing,
        isBrushActive,
        activeLineFlow,
        isAiSubjectActive,
        isParametricActive,
        brushSettings,
        onSelectMask,
        onSelectAiSubMask,
        isMasking,
        isAiEditing,
        imageRenderSize,
        adjustments,
        activeMaskId,
        activeAiSubMaskId,
        activeSubMask,
        activeSubMaskParameters,
        effectiveImageDimensions,
        isToolActive,
        brushImageSpaceSize,
        canonicalBrushTool,
        createBrushPointerSample,
        executeBrushCommands,
        getCanvasPointer,
        viewerBrushContext,
        viewerBrushController,
      ],
    );

    const handleMove = useCallback(
      (e: CanvasMoveEvent) => {
        if (isWbPickerActive) {
          if (isKonvaEvent(e)) handleWbHover(e);
          return;
        }

        let pos: Coord | null | undefined;
        if (isKonvaEvent(e)) {
          const stage = e.target.getStage();
          pos = getCanvasPointer(stage);
        } else if ('clientX' in e || ('touches' in e && e.touches[0])) {
          const stage = drawingStageRef.current;
          if (stage) {
            stage.setPointersPositions(e);
            pos = getCanvasPointer(stage);
          }
        }

        if (isToolActive) {
          if (pos) {
            setCursorPreview({ x: pos.x, y: pos.y, visible: true });
          } else {
            setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
          }
        }

        if (isBrushActive) {
          if (pos && isKonvaEvent(e)) {
            executeBrushCommands(viewerBrushController.move(viewerBrushContext, createBrushPointerSample(pos, e.evt)));
            if (e.evt.cancelable) e.evt.preventDefault();
          } else if (pos && !isKonvaEvent(e)) {
            executeBrushCommands(viewerBrushController.move(viewerBrushContext, createBrushPointerSample(pos, e)));
            if (e.cancelable) e.preventDefault();
          }
          return;
        }

        if (!isDrawing.current || !isToolActive) {
          return;
        }
        if (!isGeometryEpochCurrent(pointerGeometryEpochRef.current, overlayGeometry)) {
          finishCanvasToolInteraction('geometry-invalidated');
          return;
        }

        if (isAiSubjectActive && previewBoxRef.current) {
          if (!pos) {
            return;
          }
          const updatedBox = { ...previewBoxRef.current, end: pos };
          previewBoxRef.current = updatedBox;
          setPreviewBox(updatedBox);
          if (isKonvaEvent(e) && e.evt.cancelable) e.evt.preventDefault();
          return;
        }

        if (isInitialDrawing && dragStartPointer.current && localInitialDrawParams) {
          if (!activeSubMask) return;
          const stage = drawingStageRef.current || (isKonvaEvent(e) ? e.target.getStage() : null);
          if (!stage) return;
          const pointerPos = getCanvasPointer(stage);
          if (!pointerPos) return;

          const imagePoint = getImageSpacePoint(pointerPos);
          const x = imagePoint.x;
          const y = imagePoint.y;
          const scale = overlayGeometry.viewRadiusFromCrop(1);

          const distX = x - dragStartPointer.current.x;
          const distY = y - dragStartPointer.current.y;
          const screenThreshold = 15;
          if (Math.sqrt(distX * distX + distY * distY) < screenThreshold / scale) {
            return;
          }

          const updatedParams = { ...localInitialDrawParams };

          if (activeSubMask.type === Mask.Radial) {
            updatedParams.radiusX = Math.max(1, Math.abs(x - dragStartPointer.current.x));
            updatedParams.radiusY = Math.max(1, Math.abs(y - dragStartPointer.current.y));
          } else if (activeSubMask.type === Mask.Linear) {
            const dx = x - dragStartPointer.current.x;
            const dy = y - dragStartPointer.current.y;
            const R = Math.max(1, Math.sqrt(dx * dx + dy * dy));

            const px = -dy / R;
            const py = dx / R;
            const handleDist = Math.min(effectiveImageDimensions.width, effectiveImageDimensions.height) * 0.2;

            updatedParams.startX = dragStartPointer.current.x + px * handleDist;
            updatedParams.startY = dragStartPointer.current.y + py * handleDist;
            updatedParams.endX = dragStartPointer.current.x - px * handleDist;
            updatedParams.endY = dragStartPointer.current.y - py * handleDist;
            updatedParams.range = R;
          }

          setLocalInitialDrawParams(updatedParams);

          if (onLiveMaskPreview && activeContainer) {
            const previewSubMask = {
              ...activeSubMask,
              parameters: updatedParams,
            };
            const previewContainer = {
              ...activeContainer,
              subMasks: activeContainer.subMasks.map((sm: SubMask) =>
                sm.id === activeSubMask.id ? previewSubMask : sm,
              ),
            };
            onLiveMaskPreview(previewContainer);
          }

          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
          if (activeId) {
            viewerAdjustmentCommandServices.updateSubMask(activeId, { parameters: updatedParams });
          }

          if (isKonvaEvent(e) && e.evt.cancelable) e.evt.preventDefault();
          return;
        }

        if (!pos) {
          return;
        }
      },
      [
        isToolActive,
        isWbPickerActive,
        handleWbHover,
        isInitialDrawing,
        activeMaskId,
        activeAiSubMaskId,
        activeSubMask,
        isBrushActive,
        isAiSubjectActive,
        imageRenderSize,
        adjustments.crop,
        effectiveImageDimensions,
        isMasking,
        localInitialDrawParams,
        createBrushPointerSample,
        executeBrushCommands,
        finishCanvasToolInteraction,
        getCanvasPointer,
        getImageSpacePoint,
        viewerBrushContext,
        viewerBrushController,
      ],
    );

    const handleUp = useCallback(
      (event?: CanvasKonvaEvent) => {
        if (isBrushActive) {
          const stage = event?.target.getStage();
          const point = stage ? getCanvasPointer(stage) : null;
          executeBrushCommands(
            viewerBrushController.end(
              viewerBrushContext,
              event && point ? createBrushPointerSample(point, event.evt) : undefined,
            ),
          );
          return;
        }
        if (!isDrawing.current) {
          return;
        }
        if (!isGeometryEpochCurrent(pointerGeometryEpochRef.current, overlayGeometry)) {
          finishCanvasToolInteraction('geometry-invalidated');
          return;
        }

        if (isInitialDrawing && localInitialDrawParams && dragStartPointer.current) {
          if (!activeSubMask) {
            finishCanvasToolInteraction('invalid-initial-draw');
            return;
          }
          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

          const newParams = { ...localInitialDrawParams };
          delete newParams.isInitialDraw;

          if (activeSubMask.type === Mask.Radial && newParams.radiusX < 10 && newParams.radiusY < 10) {
            newParams.radiusX = 100;
            newParams.radiusY = 100;
          } else if (activeSubMask.type === Mask.Linear) {
            if (!newParams.range || newParams.range < 10) {
              const handleDist = Math.min(effectiveImageDimensions.width, effectiveImageDimensions.height) * 0.2;
              newParams.startX = dragStartPointer.current.x + handleDist;
              newParams.startY = dragStartPointer.current.y;
              newParams.endX = dragStartPointer.current.x - handleDist;
              newParams.endY = dragStartPointer.current.y;
              newParams.range = 100;
            }
          }

          viewerAdjustmentCommandServices.updateSubMask(activeId, { parameters: newParams });
          finishCanvasToolInteraction('pointer-up');
          return;
        }

        if (!isAiSubjectActive || !previewBoxRef.current) {
          finishCanvasToolInteraction('pointer-up-empty');
          return;
        }

        if (isAiSubjectActive && previewBoxRef.current) {
          const box = previewBoxRef.current;

          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

          const startPoint = getImageSpacePoint(box.start);
          let endPoint = getImageSpacePoint(box.end);

          const dx = box.end.x - box.start.x;
          const dy = box.end.y - box.start.y;
          if (Math.sqrt(dx * dx + dy * dy) < 5) {
            endPoint = { x: startPoint.x, y: startPoint.y };
          }

          if (activeId) {
            viewerAdjustmentCommandServices.updateSubMask(activeId, {
              parameters: {
                ...activeSubMaskParameters,
                startX: startPoint.x,
                startY: startPoint.y,
                endX: endPoint.x,
                endY: endPoint.y,
              },
            });
          }

          if (activeSubMask.type === Mask.QuickEraser) {
            onQuickErase(activeId, startPoint, endPoint);
          } else if (activeSubMask.type === Mask.AiSubject) {
            onGenerateAiMask(activeId, startPoint, endPoint);
          }
          finishCanvasToolInteraction('pointer-up');
          return;
        }

        finishCanvasToolInteraction('pointer-up');
      },
      [
        isInitialDrawing,
        activeAiSubMaskId,
        activeMaskId,
        activeSubMask,
        activeSubMaskParameters,
        isBrushActive,
        isMasking,
        onGenerateAiMask,
        onQuickErase,
        viewerAdjustmentCommandServices,
        createBrushPointerSample,
        executeBrushCommands,
        getCanvasPointer,
        getImageSpacePoint,
        effectiveImageDimensions,
        localInitialDrawParams,
        imageRenderSize,
        isAiSubjectActive,
        finishCanvasToolInteraction,
        viewerBrushContext,
        viewerBrushController,
      ],
    );

    const handleMouseEnter = useCallback(() => {
      if (isToolActive) {
        setCursorPreview((p: CursorPreview) => ({ ...p, visible: true }));
      }
    }, [isToolActive]);

    const handleMouseLeave = useCallback(() => {
      setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
      if (isWbPickerActive) {
        whiteBalanceSampleSequenceRef.current += 1;
        onWbPreviewCancel?.();
      }
    }, [isWbPickerActive, onWbPreviewCancel]);

    useEffect(() => {
      if (!isToolActive) return;

      function onGlobalMove(e: MouseEvent | TouchEvent) {
        if (!isDrawing.current && !isBrushActive) return;
        handleMove(e);
      }

      function onGlobalUp() {
        if (!isDrawing.current && !isBrushActive) return;
        handleUp();
      }

      function onGlobalCancel() {
        if (isBrushActive) {
          executeBrushCommands(viewerBrushController.cancel('pointercancel'));
          return;
        }
        if (!isDrawing.current) return;
        finishCanvasToolInteraction('pointer-cancel');
      }

      window.addEventListener('mousemove', onGlobalMove, { passive: false });
      window.addEventListener('mouseup', onGlobalUp);
      window.addEventListener('touchmove', onGlobalMove, { passive: false });
      window.addEventListener('touchcancel', onGlobalCancel);
      window.addEventListener('pointercancel', onGlobalCancel);
      return () => {
        window.removeEventListener('mousemove', onGlobalMove);
        window.removeEventListener('mouseup', onGlobalUp);
        window.removeEventListener('touchmove', onGlobalMove);
        window.removeEventListener('touchcancel', onGlobalCancel);
        window.removeEventListener('pointercancel', onGlobalCancel);
      };
    }, [
      executeBrushCommands,
      finishCanvasToolInteraction,
      handleMove,
      handleUp,
      isBrushActive,
      isToolActive,
      overlayGeometry.geometryEpoch,
      selectedImage.path,
      viewerBrushController,
    ]);

    const cropPreviewUrl = uncroppedAdjustedPreviewUrl || selectedImage.thumbnailUrl;
    const isCropViewVisible = resolveCropPreviewVisibility({ cropPreviewUrl, isCropping, loadedCropPreviewUrl });
    const originalSrc = transformedOriginalUrl;
    const canShowOriginalCompare = !!originalSrc && originalLoaded;
    const renderedPreviewWarningStatus = getRenderedPreviewWarningStatus(gamutWarningOverlay, {
      exportSoftProofRecipeId,
      exportSoftProofTransform,
      isExportSoftProofEnabled,
      selectedImagePath: selectedImage.path,
    });
    const isCurrentGamutWarningOverlay = isCurrentExportSoftProofGamutWarningOverlay(gamutWarningOverlay, {
      exportSoftProofRecipeId,
      exportSoftProofTransform,
      isExportSoftProofEnabled,
      selectedImagePath: selectedImage.path,
    });
    const overlayBlocker = resolveEditorOverlayBlocker({
      hasActiveRemoveSource: activeRemoveSource !== null,
      hasActiveRetouchSource: activeRetouchSource !== null,
      isAiEditing,
      isCropping,
      isMasking,
      isWbPickerActive: Boolean(isWbPickerActive),
    });
    const overlayVisibility = resolveEditorOverlayVisibility({
      blocker: overlayBlocker,
      canShowOriginalCompare,
      compareMode,
      hasDisplayedMask: Boolean(displayedMaskUrl),
      isCurrentGamutWarningOverlay,
      isExportSoftProofEnabled,
      isGamutWarningOverlayVisible,
      isMaskControlHovered,
      isMaskInteractionActive: effectiveMaskInteractionActive,
      isSliderDragging,
      showOriginal,
    });
    const {
      compareOverlayDisabled,
      compareOverlayDisabledReason,
      isCompareModeActive,
      isShowingOriginal,
      isSideBySideCompare,
      showGamutWarningOverlay,
      showOriginalCompare,
      showRetouchRemoveHandles,
      showSideBySideCompare,
      showSplitCompare,
    } = overlayVisibility;
    const retouchHandlesController = useViewerRetouchHandlesController({
      activeCloneLayer: activeRetouchLayer,
      activeRemoveLayer,
      activeRemoveTargetSubMask,
      adjustments: viewerAdjustmentCommandServices,
      altPressed: isAltPressed,
      geometry: overlayGeometry,
      imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
      presentation: presentationDescriptor,
      visible: showRetouchRemoveHandles && imageRenderSize.width > 0 && imageRenderSize.height > 0,
    });
    const showInteractiveToolOverlayStage =
      (isMasking || isAiEditing || Boolean(isWbPickerActive)) &&
      retouchHandlesController.activeMode === null &&
      !isCompareModeActive &&
      !showGamutWarningOverlay;

    useEffect(() => {
      if (!originalSrc) {
        setOriginalLoaded(false);
        setOriginalLoadFailed(false);
        return;
      }

      const img = new Image();
      img.src = originalSrc;

      if (img.complete) {
        setOriginalLoaded(img.naturalWidth > 0);
        setOriginalLoadFailed(img.naturalWidth === 0);
      } else {
        setOriginalLoaded(false);
        setOriginalLoadFailed(false);
        img.onload = () => {
          setOriginalLoaded(true);
          setOriginalLoadFailed(false);
        };
        img.onerror = () => {
          setOriginalLoaded(false);
          setOriginalLoadFailed(true);
        };
      }

      return () => {
        img.onload = null;
        img.onerror = null;
      };
    }, [originalSrc]);

    const patchGeometryIdentity = adjustmentGeometryRevision;
    const patchScopeKey = [
      selectedImage.path,
      patchGeometryIdentity,
      imageRenderSize.width,
      imageRenderSize.height,
      imageRenderSize.offsetX,
      imageRenderSize.offsetY,
    ].join(':');
    const patchContext = {
      basePreviewUrl: previewSource,
      geometryIdentity: patchGeometryIdentity,
      sourceImagePath: selectedImage.path,
    };
    const coherentInteractivePatch =
      interactivePatch && isInteractivePreviewPatchCoherent(interactivePatch, patchContext) ? interactivePatch : null;

    const uncroppedImageRenderSize = useMemo<Partial<RenderSize> | null>(() => {
      if (!selectedImage.width || !selectedImage.height || !imageRenderSize.width || !imageRenderSize.height) {
        return null;
      }

      const viewportWidth = imageRenderSize.width + 2 * imageRenderSize.offsetX;
      const viewportHeight = imageRenderSize.height + 2 * imageRenderSize.offsetY;

      let uncroppedEffectiveWidth = selectedImage.width;
      let uncroppedEffectiveHeight = selectedImage.height;
      const orientationSteps = adjustments.orientationSteps || 0;
      if (orientationSteps === 1 || orientationSteps === 3) {
        [uncroppedEffectiveWidth, uncroppedEffectiveHeight] = [uncroppedEffectiveHeight, uncroppedEffectiveWidth];
      }

      if (uncroppedEffectiveWidth <= 0 || uncroppedEffectiveHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
        return null;
      }

      const scale = Math.min(viewportWidth / uncroppedEffectiveWidth, viewportHeight / uncroppedEffectiveHeight);

      const renderWidth = uncroppedEffectiveWidth * scale;
      const renderHeight = uncroppedEffectiveHeight * scale;

      return { width: renderWidth, height: renderHeight };
    }, [selectedImage.width, selectedImage.height, imageRenderSize, adjustments.orientationSteps]);

    const cropImageTransforms = useMemo(() => {
      const rotation = (liveRotation !== null ? liveRotation : adjustments.rotation) ?? 0;
      return `rotate(${svgNumber(rotation)}deg)`;
    }, [adjustments.rotation, liveRotation]);

    const effectiveCursor = useMemo(() => {
      if (viewerInputState?.isTemporaryHand) return cursorStyle;
      if (isWbPickerActive) return 'crosshair';
      if (isParametricActive) return 'crosshair';
      if (isInitialDrawing) return 'crosshair';
      if (isBrushActive) return 'none';
      if (isAiSubjectActive) return 'crosshair';
      return cursorStyle;
    }, [
      isWbPickerActive,
      isInitialDrawing,
      isBrushActive,
      isAiSubjectActive,
      isParametricActive,
      cursorStyle,
      viewerInputState?.isTemporaryHand,
    ]);

    const handlePreviewUpdate = useCallback(
      (id: string, subMaskPreview: Partial<SubMask>) => {
        if (!activeContainer || !onLiveMaskPreview) return;
        const previewContainer = {
          ...activeContainer,
          subMasks: activeContainer.subMasks.map((sm: SubMask) => (sm.id === id ? { ...sm, ...subMaskPreview } : sm)),
        };
        onLiveMaskPreview(previewContainer);
      },
      [activeContainer, onLiveMaskPreview],
    );

    const handleMaskInteractionStart = useCallback(
      (e?: MaskInteractionEvent) => {
        setIsMaskInteractionActive(true);
        const eventType = e?.evt?.type;
        if (eventType === 'touchstart') {
          setIsMaskTouchInteracting(true);
        }
      },
      [setIsMaskTouchInteracting],
    );

    const handleMaskInteractionEnd = useCallback(() => {
      setIsMaskInteractionActive(false);
      setIsMaskTouchInteracting(false);
    }, [setIsMaskTouchInteracting]);

    const activeCanvasOverlayTool = isCropping
      ? 'crop'
      : pickerControllers.activeTool
        ? pickerControllers.activeTool
        : isWbPickerActive
          ? 'white-balance'
          : focusRetouchController.active
            ? 'focus-retouch'
            : retouchHandlesController.activeMode
              ? retouchHandlesController.activeMode
              : isBrushActive
                ? 'brush'
                : isAiSubjectActive
                  ? 'object-prompt'
                  : isParametricActive
                    ? 'parametric-mask'
                    : isMasking || isAiEditing
                      ? 'mask'
                      : showGamutWarningOverlay
                        ? 'soft-proof'
                        : 'pan-zoom';
    const viewerInteractionContext: ViewerInteractionContext = {
      activeTool:
        pickerControllers.activeTool ??
        (focusRetouchController.active ? 'focus-retouch' : null) ??
        viewerInputState?.activeTool ??
        'none',
      focusContext: isSliderDragging ? 'editable' : 'viewer',
      geometryEpoch: overlayGeometry.geometryEpoch,
      imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
      isTemporaryHand: viewerInputState?.isTemporaryHand ?? false,
      pointerCount: 1,
      sourceRevision: presentationDescriptor.graphRevision,
      toolId: viewerInteractionToolId(activeCanvasOverlayTool),
      zoomed: isMaxZoom ?? false,
    };
    useEffect(() => {
      viewerInteractionCoordinator.synchronize(viewerInteractionContext);
      setViewerInputOwnerState(viewerInteractionCoordinator.snapshot().owner);
    }, [
      viewerInteractionContext.activeTool,
      viewerInteractionContext.geometryEpoch,
      viewerInteractionContext.imageSessionId,
      viewerInteractionContext.sourceRevision,
      viewerInteractionContext.toolId,
      viewerInteractionCoordinator,
    ]);
    const activeCanvasOverlayStatus: CanvasOverlayStatus =
      isShowingOriginal || compareOverlayDisabled
        ? 'disabled'
        : isSliderDragging
          ? 'loading'
          : effectiveMaskInteractionActive || liveBrushLine || previewBox
            ? 'drag'
            : activeRemoveSource
              ? activeRemoveSource.status === 'ready'
                ? 'ready'
                : activeRemoveSource.status === 'stale' || activeRemoveSource.status === 'fallback_unchanged'
                  ? 'stale'
                  : 'warning'
              : pickerControllers.activeTool !== null || isToolActive || isCropping || showGamutWarningOverlay
                ? 'active'
                : 'ready';
    const canvasPointerOwner = resolveImageCanvasPointerOwner({
      isCropping,
      isMaskInteractionActive: effectiveMaskInteractionActive,
      isToolActive,
    });
    const viewerInputOwner =
      viewerInputOwnerState ?? viewerInteractionCoordinator.snapshot().owner ?? canvasPointerOwner;

    return (
      <ViewerSurface
        geometry={overlayGeometry}
        presentation={presentationDescriptor}
        className="canvas-overlay relative"
        data-canvas-overlay-status={activeCanvasOverlayStatus}
        data-canvas-overlay-tool={activeCanvasOverlayTool}
        data-canvas-pointer-owner={canvasPointerOwner}
        data-viewer-input-owner={viewerInputOwner}
        data-canvas-pointer-policy="explicit"
        data-editor-compare-overlay-disabled-reason={compareOverlayDisabledReason}
        data-editor-compare-mode={compareMode}
        data-editor-compare-original-ready={String(canShowOriginalCompare)}
        data-editor-gamut-overlay-visible={String(showGamutWarningOverlay)}
        data-editor-mask-overlay-visible={String(overlayVisibility.showMaskOverlay)}
        data-editor-overlay-blocker={overlayBlocker}
        data-mask-overlay-identity={maskOverlayRuntimeState?.identity ?? ''}
        data-mask-overlay-status={maskOverlayRuntimeState?.status ?? 'none'}
        data-preview-backend={wgpuPreviewVisibility.previewBackend}
        data-presentation-fingerprint={presentationDescriptor.fingerprint}
        data-renderer-generation={String(rendererHandoff.generation)}
        data-renderer-handoff-status={rendererHandoff.status}
        data-viewer-active-tool={
          pickerControllers.activeTool ?? viewerInputState?.activeTool ?? activeCanvasOverlayTool
        }
        data-viewer-temporary-hand={String(viewerInputState?.isTemporaryHand ?? false)}
        data-wb-picker-image-path={lastWhiteBalancePickerReceipt?.selectedImagePath ?? undefined}
        data-wb-picker-preview-identity={lastWhiteBalancePickerReceipt?.previewIdentity ?? undefined}
        data-wb-picker-result-temperature={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.resultingTemperature) : undefined
        }
        data-wb-picker-result-tint={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.resultingTint) : undefined
        }
        data-wb-picker-sample-blue={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.averageRgb.blue) : undefined
        }
        data-wb-picker-sample-green={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.averageRgb.green) : undefined
        }
        data-wb-picker-sample-preview-x={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.coordinates.previewPixelX) : undefined
        }
        data-wb-picker-sample-preview-y={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.coordinates.previewPixelY) : undefined
        }
        data-wb-picker-sample-red={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.averageRgb.red) : undefined
        }
        data-wgpu-frame-health={wgpuPreviewVisibility.health}
        data-testid="image-canvas"
        onInputEvent={(event: ViewerSurfaceInputEvent) => {
          const isCancellation =
            event.type === 'blur' ||
            event.type === 'escape' ||
            event.type === 'lostpointercapture' ||
            event.type === 'pointercancel';
          if (isCancellation) {
            executeBrushCommands(viewerBrushController.cancel(event.type));
          }
          const transition = viewerInteractionCoordinator.dispatch(event, viewerInteractionContext);
          viewerInteractionTransitionRef.current = transition;
          setViewerInputOwnerState(transition.owner);
          if (transition.forwardToTool) {
            pickerControllers.handleInputEvent(event);
            focusRetouchController.handleInputEvent(event);
          }
        }}
        onPointerLeave={handleViewerSamplerPointerLeave}
        onPointerDown={(event) => {
          const transition = viewerInteractionTransitionRef.current;
          if (transition?.shouldCapturePointer) event.currentTarget.setPointerCapture(event.pointerId);
          if (pickerControllers.activeTool !== null) {
            event.preventDefault();
            return;
          }
        }}
        onPointerMove={(event) => {
          handleViewerSamplerPointerMove(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        style={{
          width: '100%',
          height: '100%',
          cursor: pickerControllers.activeTool !== null ? 'crosshair' : effectiveCursor,
          pointerEvents: 'auto',
        }}
      >
        <>
          <PreviewSurface
            compareDividerPosition={compareDividerPosition}
            compareMode={compareMode}
            compareOrientation={compareOrientation}
            imageRenderSize={imageRenderSize}
            isCropViewVisible={isCropViewVisible}
            isMaxZoom={isMaxZoom}
            originalLoaded={originalLoaded}
            originalImageRenderSize={originalImageRenderSize}
            originalSrc={originalSrc}
            onOriginalPresented={acknowledgeOriginalPreviewUrl}
            showOriginalCompare={showOriginalCompare}
            showSideBySideCompare={isSideBySideCompare}
            showSplitCompare={showSplitCompare}
            showFrameShadow={transformState.scale <= 1.01}
            svgPreview={
              <SvgPreviewHandoff
                baseScopeKey={selectedImage.path}
                baseSource={previewSource}
                incomingPatch={coherentInteractivePatch}
                isCpuPreviewVisible={!isWgpuActive}
                isMaxZoom={isMaxZoom}
                onBasePresented={acknowledgeBasePreviewUrl}
                patchScopeKey={patchScopeKey}
                releaseUrl={releasePreviewLayerUrl}
                retainUrl={retainPreviewLayerUrl}
              />
            }
          >
            <CompareOverlay
              canShowOriginalCompare={canShowOriginalCompare}
              compareDividerPosition={compareDividerPosition}
              compareLabelsVisible={compareLabelsVisible}
              comparisonLabel={comparisonLabel}
              compareOrientation={compareOrientation}
              compareOverlayDisabled={compareOverlayDisabled}
              editedImageRect={imageRenderSize}
              isCompareModeActive={isCompareModeActive}
              onDividerPositionChange={onCompareDividerPositionChange}
              onDividerReset={onCompareDividerReset}
              originalImageRect={originalImageRenderSize}
              originalStatus={originalLoadFailed ? 'error' : canShowOriginalCompare ? 'ready' : 'loading'}
              showSideBySideCompare={showSideBySideCompare}
              showSplitCompare={showSplitCompare}
            />
            <ViewerPickerOverlay descriptors={pickerControllers.overlays} />
            <ViewerFocusRetouchOverlay descriptors={focusRetouchController.overlays} geometry={overlayGeometry} />
            {displayedMaskUrl && (
              <img
                alt={t('editor.canvas.maskOverlayAlt')}
                className="absolute object-contain pointer-events-none"
                src={displayedMaskUrl}
                style={{
                  height: cssPx(overlayGeometry.displayedImageRectInViewCssPixels.height),
                  left: cssPx(overlayGeometry.displayedImageRectInViewCssPixels.x),
                  opacity: overlayVisibility.showMaskOverlay ? 1 : 0,
                  top: cssPx(overlayGeometry.displayedImageRectInViewCssPixels.y),
                  transition: 'opacity 300ms ease-in-out',
                  width: cssPx(overlayGeometry.displayedImageRectInViewCssPixels.width),
                  imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                  zIndex: imageCanvasLayerZIndex('maskCoverage'),
                }}
              />
            )}
            {showGamutWarningOverlay && gamutWarningOverlay && (
              <div
                aria-label={t('editor.canvas.gamutWarningOverlay')}
                className="pointer-events-none absolute"
                data-coverage-ratio={gamutWarningOverlay.coverage_ratio.toFixed(6)}
                data-effective-color-profile={gamutWarningOverlay.effective_color_profile}
                data-effective-rendering-intent={gamutWarningOverlay.effective_rendering_intent}
                data-export-soft-proof-recipe-id={gamutWarningOverlay.export_soft_proof_recipe_id}
                data-preview-warning-state={renderedPreviewWarningStatus.state}
                data-proof-ready="true"
                data-preview-basis={gamutWarningOverlay.preview_basis}
                data-render-target-label={renderedPreviewWarningStatus.renderTargetLabel}
                data-source-image-path={gamutWarningOverlay.source_image_path}
                data-source-precision-path={gamutWarningOverlay.source_precision_path}
                data-transform-applied={String(gamutWarningOverlay.transform_applied)}
                data-transform-policy-fingerprint={gamutWarningOverlay.transform_policy_fingerprint}
                data-mask-height={gamutWarningOverlay.height}
                data-mask-width={gamutWarningOverlay.width}
                data-testid="gamut-warning-overlay"
                data-warning-pixel-count={gamutWarningOverlay.warning_pixel_count}
                style={{
                  height: cssPx(overlayGeometry.displayedImageRectInViewCssPixels.height),
                  left: cssPx(overlayGeometry.displayedImageRectInViewCssPixels.x),
                  top: cssPx(overlayGeometry.displayedImageRectInViewCssPixels.y),
                  width: cssPx(overlayGeometry.displayedImageRectInViewCssPixels.width),
                  zIndex: imageCanvasLayerZIndex('diagnosticPixels'),
                }}
              >
                <img
                  alt=""
                  className="h-full w-full object-fill"
                  src={gamutWarningOverlay.mask_data_url}
                  style={{
                    imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                  }}
                />
              </div>
            )}
          </PreviewSurface>

          <ViewerRetouchHandlesOverlay
            binding={retouchHandlesController}
            geometry={overlayGeometry}
            groupOffsetX={groupOffsetX}
            groupOffsetY={groupOffsetY}
            maxSafeScale={maxSafeScale}
            stageHeight={stageHeight}
            stageLeft={stageLeft}
            stageTop={stageTop}
            stageWidth={stageWidth}
            zoomScale={transformState.scale}
          />
          {showInteractiveToolOverlayStage && (
            <div
              data-brush-command-expected-graph-revision={lastBrushCommandCapture?.expectedGraphRevision ?? ''}
              data-brush-command-hash={lastBrushCommandCapture?.commandHash ?? ''}
              data-brush-command-image-path={lastBrushCommandCapture?.imagePath ?? ''}
              data-brush-command-mask-id={lastBrushCommandCapture?.maskId ?? ''}
              data-brush-command-operation-id={lastBrushCommandCapture?.operationId ?? ''}
              data-brush-command-pressure-point-count={lastBrushCommandCapture?.pressurePointCount ?? 0}
              data-brush-command-receipt-version={lastBrushCommandCapture?.receiptVersion ?? 0}
              data-brush-command-schema-version={lastBrushCommandCapture?.schemaVersion ?? 0}
              data-brush-command-coordinate-space={lastBrushCommandCapture?.coordinateSpace ?? ''}
              data-brush-command-id={lastBrushCommandCapture?.commandId ?? ''}
              data-brush-command-last-mode={lastBrushCommandCapture?.lastStrokeMode ?? ''}
              data-brush-command-last-point-count={lastBrushCommandCapture?.lastPointCount ?? 0}
              data-brush-command-stroke-count={lastBrushCommandCapture?.strokeCount ?? 0}
              data-brush-command-type={lastBrushCommandCapture?.commandType ?? ''}
              data-brush-command-validation-status={lastBrushCommandCapture?.validationStatus ?? ''}
              data-brush-live-preview-mode={liveBrushLine?.tool ?? ''}
              data-brush-live-preview-point-count={liveBrushLine?.points.length ?? 0}
              data-brush-live-preview-visible={String(liveBrushLine !== null)}
              data-testid="image-canvas-brush-command-capture"
              style={{
                position: 'absolute',
                top: stageTop,
                left: stageLeft,
                transformOrigin: '0 0',
                transform: `scale(${svgNumber(1 / maxSafeScale)})`,
                width: stageWidth * maxSafeScale,
                height: stageHeight * maxSafeScale,
                zIndex: imageCanvasLayerZIndex('activeTool'),
                touchAction: 'none',
                userSelect: 'none',
                opacity: showInteractiveToolOverlayStage ? 1 : 0,
                transition: 'opacity 150ms ease-in-out',
                ...getEdgeFadeStyle(128),
              }}
            >
              <Stage
                width={stageWidth * maxSafeScale}
                height={stageHeight * maxSafeScale}
                onMouseDown={handleStart}
                onTouchStart={handleStart}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onMouseMove={handleMove}
                onTouchMove={handleMove}
                onMouseUp={handleUp}
                onTouchEnd={handleUp}
              >
                <Layer listening={showInteractiveToolOverlayStage}>
                  <Group scaleX={maxSafeScale} scaleY={maxSafeScale}>
                    <Group x={groupOffsetX} y={groupOffsetY}>
                      {(isMasking || isAiEditing) &&
                        activeContainer &&
                        sortedSubMasks.map((subMask: SubMask) => {
                          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
                          const renderSubMask =
                            subMask.id === activeId && localInitialDrawParams
                              ? { ...subMask, parameters: localInitialDrawParams }
                              : subMask;

                          return (
                            <MaskOverlay
                              geometry={overlayGeometry}
                              isSelected={renderSubMask.id === activeId}
                              isToolActive={isToolActive}
                              key={renderSubMask.id}
                              onMaskInteractionEnd={handleMaskInteractionEnd}
                              onMaskInteractionStart={handleMaskInteractionStart}
                              onMaskMouseEnter={() => {
                                if (!isToolActive) {
                                  setIsMaskHovered(true);
                                }
                              }}
                              onMaskMouseLeave={() => {
                                if (!isToolActive) {
                                  setIsMaskHovered(false);
                                }
                              }}
                              onPreviewUpdate={handlePreviewUpdate}
                              onSelect={() => {
                                if (isMasking) {
                                  onSelectMask(renderSubMask.id);
                                } else {
                                  onSelectAiSubMask(renderSubMask.id);
                                }
                              }}
                              onUpdate={updateSubMask}
                              subMask={renderSubMask}
                              offsetX={groupOffsetX}
                              offsetY={groupOffsetY}
                              stageScale={maxSafeScale}
                            />
                          );
                        })}

                      {previewBox && (
                        <Rect
                          x={Math.min(previewBox.start.x, previewBox.end.x)}
                          y={Math.min(previewBox.start.y, previewBox.end.y)}
                          width={Math.max(0.1, Math.abs(previewBox.end.x - previewBox.start.x))}
                          height={Math.max(0.1, Math.abs(previewBox.end.y - previewBox.start.y))}
                          stroke={canvasOverlayTokens.colors.active}
                          strokeWidth={2}
                          {...canvasOverlayShadowProps}
                          dash={[4, 4]}
                          listening={false}
                        />
                      )}
                      {isBrushActive && liveBrushLine && (
                        <OptimizedBrushLine geometry={overlayGeometry} line={liveBrushLine} />
                      )}
                      {isBrushActive && cursorPreview.visible && (
                        <Circle
                          {...(brushCursorPreview.colorStops
                            ? {
                                fillRadialGradientColorStops: brushCursorPreview.colorStops,
                                fillRadialGradientEndPoint: { x: 0, y: 0 },
                                fillRadialGradientEndRadius: brushCursorPreview.radius,
                                fillRadialGradientStartPoint: { x: 0, y: 0 },
                                fillRadialGradientStartRadius: 0,
                              }
                            : { fill: brushCursorPreview.fill })}
                          listening={false}
                          perfectDrawEnabled={false}
                          radius={brushCursorPreview.radius}
                          stroke={isAltPressed ? canvasOverlayTokens.colors.eraser : canvasOverlayTokens.colors.neutral}
                          strokeOpacity={0.9}
                          strokeScaleEnabled={false}
                          strokeWidth={1.25}
                          {...canvasOverlayShadowProps}
                          x={cursorPreview.x}
                          y={cursorPreview.y}
                        />
                      )}
                    </Group>
                  </Group>
                </Layer>
              </Stage>
            </div>
          )}
        </>
        <CropOverlaySurface
          aspectRatio={adjustments.aspectRatio}
          crop={crop}
          cropImageRef={cropImageRef}
          cropImageTransform={cropImageTransforms}
          cropPreviewUrl={cropPreviewUrl}
          cropRenderSize={uncroppedImageRenderSize}
          geometry={overlayGeometry}
          handleCropComplete={handleCropComplete}
          handleCropStart={handleCropStart}
          isCropping={isCropping}
          isCropViewVisible={isCropViewVisible}
          onCropPreviewError={() => setLoadedCropPreviewUrl(null)}
          onCropPreviewLoad={() => setLoadedCropPreviewUrl(cropPreviewUrl)}
          onStraighten={onStraighten}
          isMaxZoom={isMaxZoom}
          isRotationActive={isRotationActive}
          isStraightenActive={isStraightenActive}
          overlayMode={overlayMode}
          overlayRotation={overlayRotation}
          rotationDegrees={liveRotation ?? adjustments.rotation ?? 0}
          session={cropStraightenSession}
          setCrop={setCrop}
        />
      </ViewerSurface>
    );
  },
);

ImageCanvas.displayName = 'ImageCanvas';

export default ImageCanvas;
