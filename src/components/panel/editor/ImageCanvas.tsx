import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Crop, PercentCrop } from 'react-image-crop';
import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import 'react-image-crop/dist/ReactCrop.css';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Circle, Group, Layer, Rect, Stage } from 'react-konva';
import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import type { GamutWarningOverlayPayload } from '../../../schemas/tauriEventSchemas';
import type { EditorCompareMode, ExportSoftProofTransformState, InteractivePatch } from '../../../store/useEditorStore';
import type { AiPatch, MaskContainer } from '../../../utils/adjustments';
import {
  getRenderedPreviewWarningStatus,
  isCurrentExportSoftProofGamutWarningOverlay,
} from '../../../utils/color/runtime/gamutWarningDisplay';
import { getOrientedDimensions, pixelCropFromNormalizedCrop } from '../../../utils/cropUtils';
import {
  selectEditDocumentGeometry,
  selectEditDocumentMasks,
  selectEditDocumentSourceArtifacts,
} from '../../../utils/editDocumentSelectors';
import type { EditorCompareOrientation } from '../../../utils/editorCompare';
import { resolveEditorPreviewSource, retainEditorPreviewSource } from '../../../utils/editorImagePreviewSource';
import {
  createEditorOverlayGeometry,
  type EditorOverlayGeometry,
  overlayPoint,
} from '../../../utils/editorOverlayGeometry';
import {
  advanceRendererHandoff,
  createEditorPresentationDescriptor,
  createRendererHandoffState,
  type EditorPresentationDescriptor,
} from '../../../utils/editorPresentationDescriptor';
import type { EditorReferenceViewState } from '../../../utils/editorReferenceView';
import { globalImageCache } from '../../../utils/ImageLRUCache';
import {
  InteractivePreviewUrlRegistry,
  isInteractivePreviewPatchCoherent,
} from '../../../utils/interactivePreviewPatch';
import { PreviewUrlReleaseAuthority } from '../../../utils/previewUrlReleaseAuthority';
import type { SubMaskInteractionIdentity } from '../../../utils/subMaskInteractionEditTransaction';
import { resolveWgpuPreviewVisibility } from '../../../utils/wgpuPreviewHealth';
import type {
  WhiteBalancePickerAdjustmentCommand,
  WhiteBalancePickerRuntimeReceipt,
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
import { ReferenceViewOverlay } from './ReferenceViewOverlay';
import { SvgPreviewHandoff } from './SvgPreviewHandoff';
import { useViewerToolRuntimeController } from './useViewerToolRuntimeController';
import { ViewerFocusRetouchOverlay } from './ViewerFocusRetouchOverlay';
import { ViewerPickerOverlay } from './ViewerPickerOverlay';
import { ViewerRetouchHandlesOverlay } from './ViewerRetouchHandlesOverlay';
import type { ViewerSamplerState } from './ViewerSamplerHud';
import { ViewerSamplerOverlay } from './ViewerSamplerOverlay';
import { ViewerSurface } from './ViewerSurface';
import type { ViewerAiMaskBoxCommand, ViewerAiMaskBoxCurrentContext } from './viewerAiMaskBoxInteractionController';
import type { ViewerBrushCommitResult, ViewerBrushParameters } from './viewerBrushCommandAdapter';
import type { ViewerBrushCurrentContext, ViewerBrushLine } from './viewerBrushInteractionController';
import type {
  ViewerInitialMaskDrawCommand,
  ViewerInitialMaskDrawCurrentContext,
} from './viewerInitialMaskDrawInteractionController';
import type { ViewerActiveTool } from './viewerInputResolver';
import type { ViewerMaskOverlayDescriptor } from './viewerMaskOverlayController';
import type { ViewerMaskShapeCurrentContext } from './viewerMaskShapeInteractionController';
import type {
  ViewerParametricMaskTargetCommand,
  ViewerParametricMaskTargetCurrentContext,
} from './viewerParametricMaskTargetInteractionController';
import type { ViewerPickerCommitResult } from './viewerPickerInteractionControllers';
import type { ViewerKonvaPointerEvent } from './viewerPointerEvents';
import type { ViewerRetouchCommand } from './viewerRetouchHandlesController';

const acknowledgeSurfacePaint = (): void => undefined;

declare global {
  interface Window {
    altKeyDown?: boolean;
  }
}

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

const toMaskParameters = (parameters: SubMask['parameters']): MaskParameters => parameters as MaskParameters;

const isNonPrimaryButton = (event: ViewerKonvaPointerEvent): boolean =>
  'button' in event.evt && typeof event.evt.button === 'number' && event.evt.button !== 0;

const cssPx = (value: number | undefined): string => `${String(value ?? 0)}px`;
const svgNumber = (value: number): string => String(value);
const canvasOverlayShadowProps = {
  shadowBlur: canvasOverlayTokens.shadow.blur,
  shadowColor: canvasOverlayTokens.shadow.color,
  shadowOpacity: canvasOverlayTokens.shadow.opacity,
} as const;
export interface ViewerWhiteBalanceRuntimeDescriptor {
  readonly active: boolean;
  readonly commands: {
    readonly cancelPreview?: () => void;
    readonly commit?: (command: WhiteBalancePickerAdjustmentCommand) => void;
    readonly preview?: (command: WhiteBalancePickerAdjustmentCommand) => void;
  };
  readonly imageSessionId: string;
  readonly lastReceipt: WhiteBalancePickerRuntimeReceipt | null;
}

export interface ViewerToolRuntimeDescriptor {
  readonly activeAiPatchContainerId: string | null;
  readonly activeAiSubMaskId: string | null;
  readonly activeMaskContainerId: string | null;
  readonly activeMaskId: string | null;
  readonly adjustmentGeometryRevision: number;
  readonly adjustmentRevision: number;
  readonly brushImageSessionId: string;
  readonly brushSettings: BrushSettings | null;
  readonly commands: {
    readonly commitAiMaskBox: (command: ViewerAiMaskBoxCommand) => void;
    readonly commitBrush: (command: ViewerBrushCommitResult) => void;
    readonly commitInitialMaskDraw: (command: ViewerInitialMaskDrawCommand) => void;
    readonly commitParametricMaskTarget: (command: ViewerParametricMaskTargetCommand) => void;
    readonly commitPicker?: (command: ViewerPickerCommitResult) => void;
    readonly commitRetouch: (command: ViewerRetouchCommand) => void;
    readonly commitStraighten: (value: number, identity: CropStraightenSessionIdentity) => void;
    readonly liveMaskPreview?: (previewMaskDef: MaskContainer | AiPatch) => void;
    readonly selectAiSubMask: (id: string | null) => void;
    readonly selectMask: (id: string | null) => void;
    readonly setMaskHovered: (isHovered: boolean) => void;
    readonly setMaskTouchInteracting: (isInteracting: boolean) => void;
    readonly updateSubMask: (
      id: string | null,
      subMask: Partial<SubMask>,
      identity: SubMaskInteractionIdentity,
    ) => void;
  };
  readonly compare: {
    readonly dividerPosition: number;
    readonly labelsVisible: boolean;
    readonly mode: EditorCompareMode;
    readonly onDividerPositionChange?: (position: number) => void;
    readonly onDividerReset?: () => void;
    readonly orientation: EditorCompareOrientation;
  };
  readonly crop: {
    readonly active: boolean;
    readonly onChange: (crop: Crop, percentCrop: PercentCrop) => void;
    readonly onComplete: (crop: Crop, percentCrop: PercentCrop, identity: CropStraightenSessionIdentity) => void;
    readonly onStart?: () => void;
    readonly straightenActive: boolean;
    readonly value: Crop | null;
  };
  readonly imageSessionId: string | null;
  readonly input?: { readonly activeTool: ViewerActiveTool; readonly isTemporaryHand: boolean };
  readonly isAiEditing: boolean;
  readonly isMaskControlHovered: boolean;
  readonly isMasking: boolean;
  readonly isRotationActive: boolean;
  readonly onSamplerStateChange?: (state: ViewerSamplerState) => void;
  readonly whiteBalance?: ViewerWhiteBalanceRuntimeDescriptor;
}

interface ImageCanvasProps {
  appSettings: AppSettings | null;
  editDocumentV2: EditDocumentV2;
  exportSoftProofRecipeId: string | null;
  exportSoftProofTransform: ExportSoftProofTransformState | null;
  finalPreviewUrl: string | null;
  hasCurrentCpuPreview?: boolean;
  provisionalPreviewUrl?: string | null;
  gamutWarningOverlay: GamutWarningOverlayPayload | null;
  imageRenderSize: RenderSize;
  originalImageRenderSize?: RenderSize;
  overlayGeometry?: EditorOverlayGeometry;
  isSliderDragging: boolean;
  isExportSoftProofEnabled: boolean;
  isGamutWarningOverlayVisible: boolean;
  maskOverlay: ViewerMaskOverlayDescriptor;
  selectedImage: SelectedImage;
  showOriginal: boolean;
  transformedOriginalUrl: string | null;
  comparisonLabel?: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  interactivePatch?: InteractivePatch | null;
  toolRuntime: ViewerToolRuntimeDescriptor;
  overlayMode?: OverlayMode;
  overlayRotation?: number;
  cursorStyle: string;
  isMaxZoom?: boolean;
  liveRotation?: number | null;
  transformState: { scale: number; positionX: number; positionY: number };
  hasRenderedFirstFrame: boolean;
  presentationDescriptor?: EditorPresentationDescriptor;
  wgpuFrameSerial?: number;
  wgpuFailureSerial?: number;
  viewerSampleGraphRevision?: string;
  referenceView?: EditorReferenceViewState;
  onReferenceViewCommand?: (command: 'choose' | 'clear' | 'focus-active' | 'focus-reference' | 'toggle-sync') => void;
}

const ignoreViewerPickerCommit = (): void => undefined;

export const ImageCanvas = memo(
  ({
    appSettings,
    editDocumentV2,
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    finalPreviewUrl,
    hasCurrentCpuPreview = false,
    provisionalPreviewUrl = null,
    gamutWarningOverlay,
    imageRenderSize,
    originalImageRenderSize = imageRenderSize,
    overlayGeometry: providedOverlayGeometry,
    interactivePatch,
    isSliderDragging,
    isExportSoftProofEnabled,
    isGamutWarningOverlayVisible,
    maskOverlay,
    selectedImage,
    showOriginal,
    transformedOriginalUrl,
    comparisonLabel = null,
    uncroppedAdjustedPreviewUrl,
    toolRuntime,
    overlayRotation,
    overlayMode,
    cursorStyle,
    isMaxZoom,
    liveRotation,
    transformState,
    hasRenderedFirstFrame,
    presentationDescriptor: providedPresentationDescriptor,
    wgpuFrameSerial = 0,
    wgpuFailureSerial = 0,
    viewerSampleGraphRevision = 'viewer-sample-unbound',
    referenceView,
    onReferenceViewCommand,
  }: ImageCanvasProps) => {
    const { t } = useTranslation();
    const {
      activeAiPatchContainerId,
      activeAiSubMaskId,
      activeMaskContainerId,
      activeMaskId,
      adjustmentGeometryRevision,
      adjustmentRevision,
      brushImageSessionId,
      brushSettings,
      commands,
      compare,
      crop: cropRuntime,
      imageSessionId,
      input: viewerInputState,
      isAiEditing,
      isMaskControlHovered,
      isMasking,
      isRotationActive,
      onSamplerStateChange: onViewerSamplerStateChange,
      whiteBalance: whiteBalanceRuntime,
    } = toolRuntime;
    const {
      commitAiMaskBox: onAiMaskBoxCommit,
      commitBrush: onBrushCommit,
      commitInitialMaskDraw: onInitialMaskDrawCommit,
      commitParametricMaskTarget: onParametricMaskTargetCommit,
      commitPicker: onPickerCommit = ignoreViewerPickerCommit,
      commitRetouch: onRetouchCommand,
      commitStraighten: onStraighten,
      liveMaskPreview: onLiveMaskPreview,
      selectAiSubMask: onSelectAiSubMask,
      selectMask: onSelectMask,
      setMaskHovered: setIsMaskHovered,
      setMaskTouchInteracting: setIsMaskTouchInteracting,
      updateSubMask,
    } = commands;
    const {
      dividerPosition: compareDividerPosition,
      labelsVisible: compareLabelsVisible,
      mode: compareMode,
      onDividerPositionChange: onCompareDividerPositionChange = () => undefined,
      onDividerReset: onCompareDividerReset = () => undefined,
      orientation: compareOrientation,
    } = compare;
    const {
      active: isCropping,
      onChange: setCrop,
      onComplete: handleCropComplete,
      onStart: handleCropStart = () => undefined,
      straightenActive: isStraightenActive,
      value: crop,
    } = cropRuntime;
    const isWbPickerActive = whiteBalanceRuntime?.active ?? false;
    const lastWhiteBalancePickerReceipt = whiteBalanceRuntime?.lastReceipt ?? null;
    const pickerImageSessionId =
      whiteBalanceRuntime?.imageSessionId ?? imageSessionId ?? `viewer-source:${selectedImage.path}`;
    const retainedCpuPreviewRef = useRef<{ sourceIdentity: string; url: string } | null>(null);
    const [loadedCropPreviewUrl, setLoadedCropPreviewUrl] = useState<string | null>(null);
    const cropImageRef = useRef<HTMLImageElement>(null);
    const [originalPresentation, setOriginalPresentation] = useState<{
      status: 'error' | 'ready';
      url: string;
    } | null>(null);
    const adjustments = selectEditDocumentGeometry(editDocumentV2);
    const masks = selectEditDocumentMasks(editDocumentV2);
    const aiPatches = selectEditDocumentSourceArtifacts(editDocumentV2).aiPatches;
    const orientedCropDimensions = getOrientedDimensions(
      selectedImage.width,
      selectedImage.height,
      adjustments.orientationSteps ?? 0,
    );
    const currentPixelCrop = adjustments.crop
      ? pixelCropFromNormalizedCrop(adjustments.crop, orientedCropDimensions.width, orientedCropDimensions.height)
      : null;
    const overlayGeometry = useMemo(
      () =>
        providedOverlayGeometry ??
        createEditorOverlayGeometry({
          crop: currentPixelCrop,
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
        currentPixelCrop,
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
    // A zoom/resize request can transiently clear the current render URL while
    // its successor is still rendering. Keep the last same-image CPU layer
    // available so a pending or invalid WGPU frame cannot blank the viewport.
    retainedCpuPreviewRef.current = retainEditorPreviewSource({
      currentSource: previewSource,
      retainedSource: retainedCpuPreviewRef.current,
      sourceIdentity: selectedImage.path,
    });
    const retainedCpuPreviewSource = retainedCpuPreviewRef.current?.url ?? null;
    const patchGeometryIdentity = adjustmentGeometryRevision;
    const patchContext = {
      basePreviewUrl: retainedCpuPreviewSource,
      geometryIdentity: patchGeometryIdentity,
      sourceImagePath: selectedImage.path,
    };
    const coherentInteractivePatch =
      interactivePatch && isInteractivePreviewPatchCoherent(interactivePatch, patchContext) ? interactivePatch : null;
    const presentationDescriptor = useMemo(
      () =>
        providedPresentationDescriptor ??
        createEditorPresentationDescriptor({
          colorTransformIdentity: 'fixture-display:v1',
          compareIdentity: JSON.stringify({ compareDividerPosition, compareMode, compareOrientation, showOriginal }),
          geometry: overlayGeometry,
          graphRevision: viewerSampleGraphRevision,
          overlayIdentity: JSON.stringify({ mask: maskOverlay.identity, overlayMode }),
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
        maskOverlay.identity,
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
    const [interactivePreviewUrlRegistry] = useState(() => new InteractivePreviewUrlRegistry());
    const [surfacePreviewUrlReleaseAuthority] = useState(
      () => new PreviewUrlReleaseAuthority({ isProtected: (url) => globalImageCache.isProtected(url) }),
    );
    const retainPreviewLayerUrl = useCallback(
      (owner: string, url: string) => {
        interactivePreviewUrlRegistry.claim(owner, url);
      },
      [interactivePreviewUrlRegistry],
    );

    const releasePreviewLayerUrl = useCallback(
      (owner: string, url: string, reason: 'retired' | 'unmounted') => {
        if (!interactivePreviewUrlRegistry.release(owner, url)) return;
        if (
          url === selectedImage.thumbnailUrl ||
          (reason === 'retired' &&
            (url === finalPreviewUrl || url === interactivePatch?.url || url === transformedOriginalUrl))
        ) {
          return;
        }
        surfacePreviewUrlReleaseAuthority.release(url);
      },
      [
        finalPreviewUrl,
        interactivePatch?.url,
        interactivePreviewUrlRegistry,
        selectedImage.thumbnailUrl,
        surfacePreviewUrlReleaseAuthority,
        transformedOriginalUrl,
      ],
    );

    const canonicalBrushTool = brushSettings?.tool ?? ToolType.Brush;
    const [isAltPressed, setIsAltPressed] = useState(false);

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
      hasViewportTransform:
        presentationDescriptor.semanticZoom.mode.kind !== 'fit' ||
        Math.abs(transformState.positionX) > 0.01 ||
        Math.abs(transformState.positionY) > 0.01 ||
        Math.abs(transformState.scale - 1) > 0.01,
      previewSource: retainedCpuPreviewSource,
      requiresCpuComposition: hasCurrentCpuPreview || coherentInteractivePatch !== null || isExportSoftProofEnabled,
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
        return masks.find((c: MaskContainer) => c.id === activeMaskContainerId);
      }
      if (isAiEditing) {
        return aiPatches.find((p: AiPatch) => p.id === activeAiPatchContainerId);
      }
      return null;
    }, [masks, aiPatches, activeMaskContainerId, activeAiPatchContainerId, isMasking, isAiEditing]);

    const activeRetouchLayer = useMemo(() => {
      if (!activeMaskContainerId) return null;
      const layer = masks.find((mask: MaskContainer) => mask.id === activeMaskContainerId);
      return layer?.retouchCloneSource === undefined ? null : layer;
    }, [activeMaskContainerId, masks]);

    const activeRetouchSource = activeRetouchLayer?.retouchCloneSource ?? null;

    const activeRemoveLayer = useMemo(() => {
      if (!activeMaskContainerId) return null;
      const layer = masks.find((mask: MaskContainer) => mask.id === activeMaskContainerId);
      return layer?.retouchRemoveSource === undefined ? null : layer;
    }, [activeMaskContainerId, masks]);

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
    const activeLineFlow =
      activeSubMask?.type === Mask.Flow ? (activeSubMaskParameters?.flow ?? 10) : (brushSettings?.flow ?? 100);
    const activeBrushMaskId = isMasking ? activeMaskId : activeAiSubMaskId;
    const viewerBrushContext: ViewerBrushCurrentContext = {
      active: isBrushActive && activeBrushMaskId !== null,
      adjustmentRevision,
      containerId: activeContainer?.id ?? 'brush-container:none',
      containerKind: isAiEditing ? 'aiPatches' : 'masks',
      geometryEpoch: overlayGeometry.geometryEpoch,
      imageSessionId: brushImageSessionId,
      maskId: activeBrushMaskId ?? 'brush:none',
      sourceIdentity: selectedImage.path,
      sourceRevision: presentationDescriptor.graphRevision,
      toolId: 'brush',
    };
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
    const activeAiMaskBoxId = isMasking ? activeMaskId : activeAiSubMaskId;
    const viewerAiMaskBoxContext = useMemo<ViewerAiMaskBoxCurrentContext>(
      () => ({
        active:
          isAiSubjectActive &&
          activeAiMaskBoxId !== null &&
          (isMasking ? activeMaskContainerId !== null : activeAiPatchContainerId !== null),
        containerFamily: isMasking ? 'masks' : 'aiPatches',
        containerId: (isMasking ? activeMaskContainerId : activeAiPatchContainerId) ?? 'ai-mask-box-container:none',
        geometryEpoch: overlayGeometry.geometryEpoch,
        imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
        maskId: activeAiMaskBoxId ?? 'ai-mask-box:none',
        sourceIdentity: selectedImage.path,
        sourceRevision: presentationDescriptor.graphRevision,
        tool: activeSubMask?.type === Mask.QuickEraser ? 'quick-eraser' : 'ai-subject',
      }),
      [
        activeAiMaskBoxId,
        activeAiPatchContainerId,
        activeMaskContainerId,
        activeSubMask?.type,
        imageSessionId,
        isAiSubjectActive,
        isMasking,
        overlayGeometry.geometryEpoch,
        presentationDescriptor.graphRevision,
        selectedImage.path,
      ],
    );
    const isParametricActive =
      (isMasking || isAiEditing) && (activeSubMask?.type === Mask.Color || activeSubMask?.type === Mask.Luminance);
    const activeParametricMaskId = isMasking ? activeMaskId : activeAiSubMaskId;
    const viewerParametricMaskTargetContext = useMemo<ViewerParametricMaskTargetCurrentContext>(
      () => ({
        active: isParametricActive && activeParametricMaskId !== null,
        geometryEpoch: overlayGeometry.geometryEpoch,
        imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
        maskId: activeParametricMaskId ?? 'parametric-mask:none',
        sourceIdentity: selectedImage.path,
        sourceRevision: presentationDescriptor.graphRevision,
        tool: activeSubMask?.type === Mask.Color ? 'color' : 'luminance',
      }),
      [
        activeParametricMaskId,
        activeSubMask?.type,
        imageSessionId,
        isParametricActive,
        overlayGeometry.geometryEpoch,
        presentationDescriptor.graphRevision,
        selectedImage.path,
      ],
    );
    const isInitialDrawing = (isMasking || isAiEditing) && activeSubMaskParameters?.isInitialDraw === true;
    const activeInitialMaskDrawId = isMasking ? activeMaskId : activeAiSubMaskId;
    const viewerInitialMaskDrawContext = useMemo<ViewerInitialMaskDrawCurrentContext>(
      () => ({
        active:
          isInitialDrawing &&
          activeInitialMaskDrawId !== null &&
          (activeSubMask?.type === Mask.Radial || activeSubMask?.type === Mask.Linear),
        geometryEpoch: overlayGeometry.geometryEpoch,
        imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
        maskId: activeInitialMaskDrawId ?? 'initial-mask:none',
        sourceIdentity: selectedImage.path,
        sourceRevision: presentationDescriptor.graphRevision,
        tool: activeSubMask?.type === Mask.Linear ? 'linear' : 'radial',
      }),
      [
        activeInitialMaskDrawId,
        activeSubMask?.type,
        imageSessionId,
        isInitialDrawing,
        overlayGeometry.geometryEpoch,
        presentationDescriptor.graphRevision,
        selectedImage.path,
      ],
    );
    const isObjectPromptActive = isMasking && activeSubMask?.type === Mask.AiObject;
    const isToolActive =
      isBrushActive || isAiSubjectActive || isInitialDrawing || isObjectPromptActive || isParametricActive;
    const viewerMaskShapeContext = useMemo<ViewerMaskShapeCurrentContext>(
      () => ({
        active:
          (isMasking || isAiEditing) && activeContainer !== null && activeContainer !== undefined && !isToolActive,
        containerId: activeContainer?.id ?? 'mask-shape-container:none',
        containerKind: isAiEditing ? 'aiPatches' : 'masks',
        geometryEpoch: overlayGeometry.geometryEpoch,
        imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
        sourceIdentity: selectedImage.path,
        sourceRevision: presentationDescriptor.graphRevision,
      }),
      [
        activeContainer,
        imageSessionId,
        isAiEditing,
        isMasking,
        isToolActive,
        overlayGeometry.geometryEpoch,
        presentationDescriptor.graphRevision,
        selectedImage.path,
      ],
    );
    const displayedMaskUrl = resolveDisplayedMaskUrl({ isAiEditing, isMasking, maskOverlayUrl: maskOverlay.url });

    const sortedSubMasks = useMemo(() => {
      if (!activeContainer) {
        return [];
      }
      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
      const selectedMask = activeContainer.subMasks.find((m: SubMask) => m.id === activeId);
      const otherMasks = activeContainer.subMasks.filter((m: SubMask) => m.id !== activeId);
      return selectedMask ? [...otherMasks, selectedMask] : activeContainer.subMasks;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking]);

    const handleStart = useCallback(
      (e: ViewerKonvaPointerEvent) => {
        if (isNonPrimaryButton(e)) {
          return;
        }

        if (e.evt.cancelable) e.evt.preventDefault();

        if (!isToolActive) {
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
      [onSelectMask, onSelectAiSubMask, isMasking, isAiEditing, isToolActive],
    );

    const cropPreviewUrl = uncroppedAdjustedPreviewUrl || selectedImage.thumbnailUrl;
    const isCropViewVisible = resolveCropPreviewVisibility({ cropPreviewUrl, isCropping, loadedCropPreviewUrl });
    const originalSrc = transformedOriginalUrl;
    const originalLoaded =
      originalSrc !== null && originalPresentation?.url === originalSrc && originalPresentation.status === 'ready';
    const originalLoadFailed =
      originalSrc !== null && originalPresentation?.url === originalSrc && originalPresentation.status === 'error';
    const canShowOriginalCompare = originalLoaded;
    const handleOriginalPresented = useCallback(
      (url: string) => {
        if (url !== transformedOriginalUrl) return;
        setOriginalPresentation({ status: 'ready', url });
      },
      [transformedOriginalUrl],
    );
    const handleOriginalFailed = useCallback(
      (url: string) => {
        if (url !== transformedOriginalUrl) return;
        setOriginalPresentation({ status: 'error', url });
      },
      [transformedOriginalUrl],
    );
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
    const patchScopeKey = [
      selectedImage.path,
      patchGeometryIdentity,
      imageRenderSize.width,
      imageRenderSize.height,
      imageRenderSize.offsetX,
      imageRenderSize.offsetY,
    ].join(':');
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
    const cropRenderSize = useMemo(
      () =>
        uncroppedImageRenderSize?.width !== undefined && uncroppedImageRenderSize.height !== undefined
          ? { height: uncroppedImageRenderSize.height, width: uncroppedImageRenderSize.width }
          : null,
      [uncroppedImageRenderSize],
    );
    const toolControllerRuntime = useViewerToolRuntimeController({
      aiMaskBox: {
        baselineParameters: activeSubMaskParameters,
        context: viewerAiMaskBoxContext,
        geometry: overlayGeometry,
        groupOffsetX,
        groupOffsetY,
        maxSafeScale,
        onCommit: onAiMaskBoxCommit,
      },
      brush: {
        activeContainer: activeContainer ?? null,
        activeSubMask: activeSubMask ?? null,
        context: viewerBrushContext,
        geometry: overlayGeometry,
        groupOffsetX,
        groupOffsetY,
        imagePath: selectedImage.path,
        imageSize: effectiveImageDimensions,
        maxSafeScale,
        onCommit: onBrushCommit,
        ...(onLiveMaskPreview === undefined ? {} : { onLiveMaskPreview }),
        parameters: activeSubMaskParameters,
        settings: {
          canonicalTool: canonicalBrushTool === ToolType.Eraser ? 'eraser' : 'brush',
          ...(brushSettings?.density === undefined ? {} : { density: brushSettings.density / 100 }),
          feather: brushSettings?.feather ? brushSettings.feather / 100 : 0,
          ...(activeLineFlow === undefined ? {} : { flow: activeLineFlow }),
          imageSpaceSize: brushImageSpaceSize,
        },
      },
      compareDivider: {
        context: {
          geometryEpoch: overlayGeometry.geometryEpoch,
          imageRect: imageRenderSize,
          imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
          orientation: compareOrientation,
          position: compareDividerPosition,
          sourceIdentity: presentationDescriptor.sourceIdentity,
          sourceRevision: presentationDescriptor.graphRevision,
        },
        onPositionChange: onCompareDividerPositionChange,
        onReset: onCompareDividerReset,
      },
      cropStraighten: {
        onCropChange: setCrop,
        onCropComplete: handleCropComplete,
        onCropStart: handleCropStart,
        onStraighten,
        renderSize: cropRenderSize,
        rotationDegrees: liveRotation ?? adjustments.rotation ?? 0,
        session: cropStraightenSession,
      },
      focusRetouch: {
        geometry: overlayGeometry,
        imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
        presentation: presentationDescriptor,
      },
      initialMaskDraw: {
        activeContainer: activeContainer ?? null,
        activeSubMask: activeSubMask ?? null,
        baselineParameters: activeSubMaskParameters,
        context: viewerInitialMaskDrawContext,
        geometry: overlayGeometry,
        groupOffsetX,
        groupOffsetY,
        imageSize: effectiveImageDimensions,
        maxSafeScale,
        onCommit: onInitialMaskDrawCommit,
        ...(onLiveMaskPreview === undefined ? {} : { onLiveMaskPreview }),
      },
      interaction: {
        geometryEpoch: overlayGeometry.geometryEpoch,
        imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
        isCropping,
        isMaxZoom: isMaxZoom ?? false,
        isSliderDragging,
        isStraightenActive,
        isTemporaryHand: viewerInputState?.isTemporaryHand ?? false,
        requestedActiveTool: viewerInputState?.activeTool,
        sourceIdentity: presentationDescriptor.sourceIdentity,
        sourceRevision: presentationDescriptor.graphRevision,
      },
      maskShape: {
        activeContainer: activeContainer ?? null,
        context: viewerMaskShapeContext,
        isToolActive,
        onCommit: updateSubMask,
        onHoverChange: setIsMaskHovered,
        ...(onLiveMaskPreview === undefined ? {} : { onLiveMaskPreview }),
        onSelectAiSubMask,
        onSelectMask,
        onTouchInteractionChange: setIsMaskTouchInteracting,
      },
      overlayBlocker: {
        hasActiveRemoveSource: activeRemoveSource !== null,
        hasActiveRetouchSource: activeRetouchSource !== null,
        isAiEditing,
        isCropping,
        isMasking,
        isWbPickerActive: Boolean(isWbPickerActive),
      },
      overlayVisibility: {
        canShowOriginalCompare,
        compareMode,
        hasDisplayedMask: Boolean(displayedMaskUrl),
        isCurrentGamutWarningOverlay,
        isExportSoftProofEnabled,
        isGamutWarningOverlayVisible,
        isMaskControlHovered,
        isSliderDragging,
        showOriginal,
      },
      parametricMaskTarget: {
        baselineParameters: activeSubMaskParameters,
        context: viewerParametricMaskTargetContext,
        geometry: overlayGeometry,
        groupOffsetX,
        groupOffsetY,
        maxSafeScale,
        onCommit: onParametricMaskTargetCommit,
        settings: {
          flipHorizontal: adjustments.flipHorizontal ?? false,
          flipVertical: adjustments.flipVertical ?? false,
          orientationSteps: adjustments.orientationSteps ?? 0,
          rotation: adjustments.rotation ?? 0,
        },
      },
      picker: {
        adjustmentRevision,
        editDocumentV2,
        geometry: overlayGeometry,
        imageSessionId: pickerImageSessionId,
        onCommit: onPickerCommit,
        presentation: presentationDescriptor,
      },
      retouchHandles: {
        activeCloneLayer: activeRetouchLayer,
        activeRemoveLayer,
        activeRemoveTargetSubMask,
        altPressed: isAltPressed,
        geometry: overlayGeometry,
        imageSessionId: imageSessionId ?? `viewer-source:${selectedImage.path}`,
        onCommit: onRetouchCommand,
        presentation: presentationDescriptor,
        renderable: imageRenderSize.width > 0 && imageRenderSize.height > 0,
      },
      sampler: {
        backend: wgpuPreviewVisibility.previewBackend,
        compareDividerPosition,
        compareMode,
        compareOrientation,
        displayedImageRect: overlayGeometry.displayedImageRectInViewCssPixels,
        editedRenderSize: imageRenderSize,
        geometryEpoch: overlayGeometry.geometryEpoch,
        graphRevision: viewerSampleGraphRevision,
        imageIdentity: selectedImage.path,
        imageSessionId: imageSessionId ?? pickerImageSessionId,
        ...(onViewerSamplerStateChange === undefined ? {} : { onStateChange: onViewerSamplerStateChange }),
        originalRenderSize: originalImageRenderSize,
        proofEnabled: isExportSoftProofEnabled,
        proofRecipeId: exportSoftProofRecipeId ?? null,
        sourceImageSize: { height: selectedImage.height, width: selectedImage.width },
      },
      suppression: {
        isAiEditing,
        isCropping,
        isMasking,
        isRotationActive: Boolean(isRotationActive),
        isSliderDragging,
        isStraightenActive,
        isToolActive,
        isWhiteBalanceActive: isWbPickerActive,
        requestedActiveTool: viewerInputState?.activeTool,
      },
      whiteBalance: {
        active: isWbPickerActive,
        geometry: overlayGeometry,
        imageSessionId: pickerImageSessionId,
        ...(whiteBalanceRuntime?.commands.commit === undefined
          ? {}
          : { onCommit: whiteBalanceRuntime.commands.commit }),
        ...(whiteBalanceRuntime?.commands.preview === undefined
          ? {}
          : { onPreview: whiteBalanceRuntime.commands.preview }),
        ...(whiteBalanceRuntime?.commands.cancelPreview === undefined
          ? {}
          : { onPreviewCancel: whiteBalanceRuntime.commands.cancelPreview }),
        presentation: presentationDescriptor,
        previewUrl: finalPreviewUrl,
        selectedImagePath: selectedImage.path,
      },
    });
    const {
      aiMaskBox: viewerAiMaskBoxBinding,
      brush: viewerBrushBinding,
      compareDivider: compareDividerController,
      cropStraighten: cropStraightenController,
      focusRetouch: focusRetouchController,
      initialMaskDraw: viewerInitialMaskDrawBinding,
      interaction: viewerInteraction,
      maskShape: viewerMaskShapeBinding,
      overlayBlocker,
      overlayVisibility,
      parametricMaskTarget: viewerParametricMaskTargetBinding,
      picker: pickerControllers,
      retouchHandles: retouchHandlesController,
      sampler: viewerSamplerController,
      whiteBalance: whiteBalanceController,
    } = toolControllerRuntime;
    const effectiveMaskInteractionActive = viewerMaskShapeBinding.active;
    const {
      compareOverlayDisabled,
      compareOverlayDisabledReason,
      isCompareModeActive,
      isShowingOriginal,
      isSideBySideCompare,
      showGamutWarningOverlay,
      showOriginalCompare,
      showSideBySideCompare,
      showSplitCompare,
    } = overlayVisibility;
    const showInteractiveToolOverlayStage =
      (isMasking || isAiEditing) &&
      retouchHandlesController.activeMode === null &&
      !isCompareModeActive &&
      !showGamutWarningOverlay;
    const viewerParametricMaskTargetOverlayPoint = useMemo(() => {
      const descriptor = viewerParametricMaskTargetBinding.overlay;
      if (descriptor === null) return null;
      return overlayGeometry.cropToView(
        overlayGeometry.orientedToCrop(
          overlayPoint<'oriented-pixels'>(descriptor.imagePoint.x, descriptor.imagePoint.y),
        ),
      );
    }, [overlayGeometry, viewerParametricMaskTargetBinding.overlay]);
    const handleMouseEnter = useCallback(() => {
      viewerBrushBinding.handleMouseEnter();
    }, [viewerBrushBinding]);
    const handleMouseLeave = useCallback(() => {
      viewerBrushBinding.handleMouseLeave();
    }, [viewerBrushBinding]);
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

    const activeCanvasOverlayTool = isCropping
      ? isStraightenActive
        ? 'straighten'
        : 'crop'
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
    const activeCanvasOverlayStatus: CanvasOverlayStatus =
      isShowingOriginal || compareOverlayDisabled
        ? 'disabled'
        : isSliderDragging
          ? 'loading'
          : effectiveMaskInteractionActive ||
              viewerBrushBinding.liveLine ||
              viewerAiMaskBoxBinding.overlay ||
              viewerInitialMaskDrawBinding.overlay
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
    const viewerInputOwner = viewerInteraction.owner ?? canvasPointerOwner;

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
        data-initial-mask-draw-active={String(viewerInitialMaskDrawBinding.active)}
        data-initial-mask-draw-context-active={String(viewerInitialMaskDrawContext.active)}
        data-initial-mask-draw-context-geometry={viewerInitialMaskDrawContext.geometryEpoch}
        data-initial-mask-draw-context-mask={viewerInitialMaskDrawContext.maskId}
        data-initial-mask-draw-context-revision={viewerInitialMaskDrawContext.sourceRevision}
        data-initial-mask-draw-context-session={viewerInitialMaskDrawContext.imageSessionId}
        data-initial-mask-draw-context-tool={viewerInitialMaskDrawContext.tool}
        data-initial-mask-draw-controller-active={String(viewerInitialMaskDrawBinding.active)}
        data-initial-mask-draw-pointer-id={viewerInitialMaskDrawBinding.overlay?.input.pointerId ?? 0}
        data-initial-mask-draw-pointer-type={viewerInitialMaskDrawBinding.overlay?.input.pointerType ?? 'none'}
        data-initial-mask-draw-session={viewerInitialMaskDrawBinding.overlay?.id ?? ''}
        data-initial-mask-draw-transition={viewerInitialMaskDrawBinding.transition}
        data-mask-shape-controller-active={String(viewerMaskShapeBinding.active)}
        data-mask-shape-context-active={String(viewerMaskShapeContext.active)}
        data-mask-shape-context-container={viewerMaskShapeContext.containerId}
        data-mask-shape-context-geometry={viewerMaskShapeContext.geometryEpoch}
        data-mask-shape-context-session={viewerMaskShapeContext.imageSessionId}
        data-mask-shape-context-source={viewerMaskShapeContext.sourceIdentity}
        data-mask-shape-pointer-id={viewerMaskShapeBinding.sessionKey?.pointerId ?? ''}
        data-mask-shape-pointer-type={viewerMaskShapeBinding.sessionKey?.pointerType ?? ''}
        data-mask-shape-session={viewerMaskShapeBinding.sessionKey?.operationId ?? ''}
        data-mask-shape-sub-mask={viewerMaskShapeBinding.sessionKey?.subMaskId ?? ''}
        data-mask-shape-transition={viewerMaskShapeBinding.transition}
        data-editor-compare-overlay-disabled-reason={compareOverlayDisabledReason}
        data-editor-compare-mode={compareMode}
        data-editor-compare-original-ready={String(canShowOriginalCompare)}
        data-editor-gamut-overlay-visible={String(showGamutWarningOverlay)}
        data-editor-mask-overlay-visible={String(overlayVisibility.showMaskOverlay)}
        data-editor-overlay-blocker={overlayBlocker}
        data-mask-overlay-identity={maskOverlay.identity}
        data-mask-overlay-operation={maskOverlay.key?.operationGeneration ?? ''}
        data-mask-overlay-status={maskOverlay.status}
        data-mask-overlay-url-present={String(displayedMaskUrl !== null)}
        data-preview-backend={wgpuPreviewVisibility.previewBackend}
        data-presentation-fingerprint={presentationDescriptor.fingerprint}
        data-renderer-generation={String(rendererHandoff.generation)}
        data-renderer-handoff-status={rendererHandoff.status}
        data-viewer-active-tool={
          pickerControllers.activeTool ?? viewerInputState?.activeTool ?? activeCanvasOverlayTool
        }
        data-viewer-temporary-hand={String(viewerInputState?.isTemporaryHand ?? false)}
        data-wb-picker-image-path={lastWhiteBalancePickerReceipt?.selectedImagePath ?? undefined}
        data-wb-picker-gesture-pointer-id={whiteBalanceController.gesturePointerId ?? ''}
        data-wb-picker-last-status={whiteBalanceController.lastStatus}
        data-wb-picker-pending-intent={whiteBalanceController.pendingIntent ?? ''}
        data-wb-picker-pending-pointer-id={whiteBalanceController.pendingPointerId ?? ''}
        data-wb-picker-preview-identity={lastWhiteBalancePickerReceipt?.previewIdentity ?? undefined}
        data-wb-picker-result-kelvin={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.resultingKelvin) : undefined
        }
        data-wb-picker-result-duv={
          lastWhiteBalancePickerReceipt ? String(lastWhiteBalancePickerReceipt.resultingDuv) : undefined
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
        data-parametric-mask-context-active={String(viewerParametricMaskTargetContext.active)}
        data-parametric-mask-context-geometry={viewerParametricMaskTargetContext.geometryEpoch}
        data-parametric-mask-context-id={viewerParametricMaskTargetContext.maskId}
        data-parametric-mask-context-revision={viewerParametricMaskTargetContext.sourceRevision}
        data-parametric-mask-context-session={viewerParametricMaskTargetContext.imageSessionId}
        data-parametric-mask-context-source={viewerParametricMaskTargetContext.sourceIdentity}
        data-parametric-mask-context-tool={viewerParametricMaskTargetContext.tool}
        data-parametric-mask-controller-active={String(viewerParametricMaskTargetBinding.active)}
        data-parametric-mask-operation={viewerParametricMaskTargetBinding.overlay?.key.operationGeneration ?? 0}
        data-parametric-mask-pointer-id={viewerParametricMaskTargetBinding.overlay?.key.pointerId ?? ''}
        data-parametric-mask-pointer-type={viewerParametricMaskTargetBinding.overlay?.key.pointerType ?? ''}
        data-parametric-mask-transition={viewerParametricMaskTargetBinding.transition}
        data-ai-mask-box-active={String(viewerAiMaskBoxBinding.active)}
        data-ai-mask-box-context-active={String(viewerAiMaskBoxContext.active)}
        data-ai-mask-box-controller="ready"
        data-ai-mask-box-context-container={viewerAiMaskBoxContext.containerId}
        data-ai-mask-box-context-family={viewerAiMaskBoxContext.containerFamily}
        data-ai-mask-box-context-geometry={String(viewerAiMaskBoxContext.geometryEpoch)}
        data-ai-mask-box-context-mask={viewerAiMaskBoxContext.maskId}
        data-ai-mask-box-context-revision={viewerAiMaskBoxContext.sourceRevision}
        data-ai-mask-box-context-tool={viewerAiMaskBoxContext.tool}
        data-ai-mask-box-operation={viewerAiMaskBoxBinding.overlay?.sessionKey.operationGeneration ?? 0}
        data-ai-mask-box-pointer-id={viewerAiMaskBoxBinding.overlay?.input.pointerId ?? ''}
        data-ai-mask-box-pointer-type={viewerAiMaskBoxBinding.overlay?.input.pointerType ?? ''}
        data-ai-mask-box-transition={viewerAiMaskBoxBinding.transition}
        data-retouch-interaction-active={String(retouchHandlesController.interactionActive)}
        data-retouch-last-commit-status={retouchHandlesController.lastCommitStatus}
        data-viewer-sampler-locked={String(viewerSamplerController.state.locked)}
        data-viewer-sampler-request-identity={viewerSamplerController.state.result?.requestIdentity ?? ''}
        data-viewer-sampler-status={viewerSamplerController.state.result?.status ?? 'idle'}
        data-viewer-sampler-suppressed={String(viewerSamplerController.state.suppressed)}
        data-viewer-sampler-target={viewerSamplerController.state.target}
        data-testid="image-canvas"
        onInputEvent={referenceView?.activePane === 'reference' ? () => undefined : viewerInteraction.handleInputEvent}
        onPointerLeave={() => {
          viewerSamplerController.handlePointerLeave();
          whiteBalanceController.cancelPreview();
        }}
        onPointerDown={(event) => {
          if (viewerInteraction.shouldCapturePointer(event.pointerId) && event.nativeEvent.isTrusted) {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          if (pickerControllers.activeTool !== null || whiteBalanceController.active) {
            event.preventDefault();
            return;
          }
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
            originalImageRenderSize={originalImageRenderSize}
            originalScopeKey={selectedImage.path}
            originalSrc={originalSrc}
            onOriginalFailed={handleOriginalFailed}
            onOriginalPresented={handleOriginalPresented}
            releasePreviewUrl={releasePreviewLayerUrl}
            retainPreviewUrl={retainPreviewLayerUrl}
            showOriginalCompare={showOriginalCompare}
            showSideBySideCompare={isSideBySideCompare}
            showSplitCompare={showSplitCompare}
            showFrameShadow={transformState.scale <= 1.01}
            svgPreview={
              <SvgPreviewHandoff
                baseScopeKey={selectedImage.path}
                baseSource={retainedCpuPreviewSource}
                incomingPatch={coherentInteractivePatch}
                isCpuPreviewVisible={!isWgpuActive}
                isMaxZoom={isMaxZoom}
                onBasePresented={acknowledgeSurfacePaint}
                patchScopeKey={patchScopeKey}
                releaseUrl={releasePreviewLayerUrl}
                retainUrl={retainPreviewLayerUrl}
              />
            }
          >
            <CompareOverlay
              canShowOriginalCompare={canShowOriginalCompare}
              compareLabelsVisible={compareLabelsVisible}
              comparisonLabel={comparisonLabel}
              compareOrientation={compareOrientation}
              compareOverlayDisabled={compareOverlayDisabled}
              editedImageRect={imageRenderSize}
              descriptor={compareDividerController.descriptor}
              isCompareModeActive={isCompareModeActive}
              originalImageRect={originalImageRenderSize}
              originalStatus={originalLoadFailed ? 'error' : canShowOriginalCompare ? 'ready' : 'loading'}
              showSideBySideCompare={showSideBySideCompare}
              showSplitCompare={showSplitCompare}
            />
            {referenceView && referenceView.mode !== 'off' && onReferenceViewCommand && (
              <ReferenceViewOverlay
                activePath={selectedImage.path}
                onChoose={() => onReferenceViewCommand('choose')}
                onClear={() => onReferenceViewCommand('clear')}
                onFocus={(pane) => onReferenceViewCommand(pane === 'active' ? 'focus-active' : 'focus-reference')}
                onToggleSync={() => onReferenceViewCommand('toggle-sync')}
                state={referenceView}
              />
            )}
            <ViewerPickerOverlay descriptors={pickerControllers.overlays} />
            <ViewerSamplerOverlay descriptor={viewerSamplerController.overlay} />
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
            descriptor={retouchHandlesController.descriptor}
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
              data-brush-command-adjustment-revision={viewerBrushBinding.commandCapture?.adjustmentRevision ?? ''}
              data-brush-command-expected-graph-revision={
                viewerBrushBinding.commandCapture?.expectedGraphRevision ?? ''
              }
              data-brush-command-hash={viewerBrushBinding.commandCapture?.commandHash ?? ''}
              data-brush-command-image-path={viewerBrushBinding.commandCapture?.imagePath ?? ''}
              data-brush-command-image-session-id={viewerBrushBinding.commandCapture?.imageSessionId ?? ''}
              data-brush-command-container-id={viewerBrushBinding.commandCapture?.containerId ?? ''}
              data-brush-command-container-kind={viewerBrushBinding.commandCapture?.containerKind ?? ''}
              data-brush-command-mask-id={viewerBrushBinding.commandCapture?.maskId ?? ''}
              data-brush-command-operation-id={viewerBrushBinding.commandCapture?.operationId ?? ''}
              data-brush-command-pressure-point-count={viewerBrushBinding.commandCapture?.pressurePointCount ?? 0}
              data-brush-command-receipt-version={viewerBrushBinding.commandCapture?.receiptVersion ?? 0}
              data-brush-command-schema-version={viewerBrushBinding.commandCapture?.schemaVersion ?? 0}
              data-brush-command-source-identity={viewerBrushBinding.commandCapture?.sourceIdentity ?? ''}
              data-brush-command-coordinate-space={viewerBrushBinding.commandCapture?.coordinateSpace ?? ''}
              data-brush-command-id={viewerBrushBinding.commandCapture?.commandId ?? ''}
              data-brush-command-last-mode={viewerBrushBinding.commandCapture?.lastStrokeMode ?? ''}
              data-brush-command-last-point-count={viewerBrushBinding.commandCapture?.lastPointCount ?? 0}
              data-brush-command-stroke-count={viewerBrushBinding.commandCapture?.strokeCount ?? 0}
              data-brush-command-type={viewerBrushBinding.commandCapture?.commandType ?? ''}
              data-brush-command-validation-status={viewerBrushBinding.commandCapture?.validationStatus ?? ''}
              data-brush-controller-active={String(viewerBrushContext.active)}
              data-brush-session-state={
                viewerBrushBinding.liveLine !== null
                  ? 'painting'
                  : viewerBrushBinding.cursor.visible
                    ? 'cursor'
                    : 'idle'
              }
              data-brush-paint-tool={canonicalBrushTool === ToolType.Eraser ? 'erase' : 'paint'}
              data-brush-size={String(brushSettings?.size ?? 0)}
              data-brush-feather={String(brushSettings?.feather ?? 0)}
              data-brush-flow={String(brushSettings?.flow ?? activeLineFlow ?? 100)}
              data-brush-density={String(brushSettings?.density ?? 100)}
              data-brush-live-preview-mode={viewerBrushBinding.liveLine?.tool ?? ''}
              data-brush-live-preview-point-count={viewerBrushBinding.liveLine?.points.length ?? 0}
              data-brush-live-preview-first-x={viewerBrushBinding.liveLine?.points[0]?.x ?? ''}
              data-brush-live-preview-first-y={viewerBrushBinding.liveLine?.points[0]?.y ?? ''}
              data-brush-live-preview-last-x={viewerBrushBinding.liveLine?.points.at(-1)?.x ?? ''}
              data-brush-live-preview-last-y={viewerBrushBinding.liveLine?.points.at(-1)?.y ?? ''}
              data-brush-live-preview-visible={String(viewerBrushBinding.liveLine !== null)}
              data-testid="image-canvas-brush-command-capture"
              data-initial-mask-draw-stage="true"
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
                onMouseDown={(event) => {
                  if (
                    !viewerBrushBinding.handleMouseDown(event) &&
                    !viewerAiMaskBoxBinding.handleMouseDown(event) &&
                    !viewerInitialMaskDrawBinding.handleMouseDown(event) &&
                    !viewerParametricMaskTargetBinding.handleMouseDown(event)
                  )
                    handleStart(event);
                }}
                onTouchStart={(event) => {
                  if (
                    !viewerBrushBinding.handleTouchStart(event) &&
                    !viewerAiMaskBoxBinding.handleTouchStart(event) &&
                    !viewerInitialMaskDrawBinding.handleTouchStart(event) &&
                    !viewerParametricMaskTargetBinding.handleTouchStart(event)
                  )
                    handleStart(event);
                }}
                onPointerDown={(event) => {
                  if (
                    !viewerBrushBinding.handlePenDown(event) &&
                    !viewerAiMaskBoxBinding.handlePenDown(event) &&
                    !viewerParametricMaskTargetBinding.handlePenDown(event)
                  )
                    viewerInitialMaskDrawBinding.handlePenDown(event);
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onMouseMove={(event) => {
                  if (!viewerBrushBinding.handleMouseMove(event) && !viewerAiMaskBoxBinding.handleMouseMove(event))
                    viewerInitialMaskDrawBinding.handleMouseMove(event);
                }}
                onTouchMove={(event) => {
                  if (!viewerBrushBinding.handleTouchMove(event) && !viewerAiMaskBoxBinding.handleTouchMove(event))
                    viewerInitialMaskDrawBinding.handleTouchMove(event);
                }}
                onPointerMove={(event) => {
                  if (!viewerBrushBinding.handlePenMove(event) && !viewerAiMaskBoxBinding.handlePenMove(event))
                    viewerInitialMaskDrawBinding.handlePenMove(event);
                }}
                onMouseUp={(event) => {
                  if (
                    !viewerBrushBinding.handleMouseUp(event) &&
                    !viewerAiMaskBoxBinding.handleMouseUp(event) &&
                    !viewerInitialMaskDrawBinding.handleMouseUp(event) &&
                    !viewerParametricMaskTargetBinding.handleMouseUp(event)
                  )
                    viewerMaskShapeBinding.release(event.evt);
                }}
                onTouchEnd={(event) => {
                  if (
                    !viewerBrushBinding.handleTouchEnd(event) &&
                    !viewerAiMaskBoxBinding.handleTouchEnd(event) &&
                    !viewerInitialMaskDrawBinding.handleTouchEnd(event) &&
                    !viewerParametricMaskTargetBinding.handleTouchEnd(event)
                  )
                    viewerMaskShapeBinding.release(event.evt);
                }}
                onTouchCancel={(event: KonvaEventObject<TouchEvent>) => {
                  viewerParametricMaskTargetBinding.handleTouchCancel(event);
                }}
                onPointerUp={(event) => {
                  if (
                    !viewerBrushBinding.handlePenUp(event) &&
                    !viewerAiMaskBoxBinding.handlePenUp(event) &&
                    !viewerInitialMaskDrawBinding.handlePenUp(event) &&
                    !viewerParametricMaskTargetBinding.handlePenUp(event)
                  )
                    viewerMaskShapeBinding.release(event.evt);
                }}
                onPointerCancel={(event) => {
                  if (
                    !viewerBrushBinding.handlePenCancel(event) &&
                    !viewerAiMaskBoxBinding.handlePenCancel(event) &&
                    !viewerParametricMaskTargetBinding.handlePenCancel(event)
                  )
                    viewerInitialMaskDrawBinding.handlePenCancel(event);
                }}
              >
                <Layer listening={showInteractiveToolOverlayStage}>
                  <Group scaleX={maxSafeScale} scaleY={maxSafeScale}>
                    <Group x={groupOffsetX} y={groupOffsetY}>
                      {(isMasking || isAiEditing) &&
                        activeContainer &&
                        sortedSubMasks.map((subMask: SubMask) => {
                          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
                          const renderSubMask =
                            subMask.id === activeId && viewerInitialMaskDrawBinding.overlay?.maskId === subMask.id
                              ? { ...subMask, parameters: { ...viewerInitialMaskDrawBinding.overlay.parameters } }
                              : subMask;

                          return (
                            <Group key={renderSubMask.id} listening={!isInitialDrawing}>
                              <MaskOverlay
                                geometry={overlayGeometry}
                                interactionResetEpoch={viewerMaskShapeBinding.resetEpoch}
                                isSelected={renderSubMask.id === activeId}
                                isToolActive={isToolActive}
                                onMaskInteractionCancel={viewerMaskShapeBinding.cancel}
                                onMaskInteractionEnd={viewerMaskShapeBinding.end}
                                onMaskInteractionStart={(event) =>
                                  viewerMaskShapeBinding.begin(
                                    {
                                      containerId: activeContainer.id,
                                      containerKind: isMasking ? 'masks' : 'aiPatches',
                                      subMaskId: renderSubMask.id,
                                    },
                                    event,
                                  )
                                }
                                onMaskMouseEnter={() => viewerMaskShapeBinding.hover(true)}
                                onMaskMouseLeave={() => viewerMaskShapeBinding.hover(false)}
                                onPreviewUpdate={viewerMaskShapeBinding.preview}
                                onSelect={() => viewerMaskShapeBinding.select(renderSubMask.id)}
                                onUpdate={viewerMaskShapeBinding.commit}
                                subMask={renderSubMask}
                                offsetX={groupOffsetX}
                                offsetY={groupOffsetY}
                                stageScale={maxSafeScale}
                              />
                            </Group>
                          );
                        })}

                      {viewerAiMaskBoxBinding.overlay && (
                        <Rect
                          x={Math.min(
                            viewerAiMaskBoxBinding.overlay.start.viewPoint.x,
                            viewerAiMaskBoxBinding.overlay.end.viewPoint.x,
                          )}
                          y={Math.min(
                            viewerAiMaskBoxBinding.overlay.start.viewPoint.y,
                            viewerAiMaskBoxBinding.overlay.end.viewPoint.y,
                          )}
                          width={Math.max(
                            0.1,
                            Math.abs(
                              viewerAiMaskBoxBinding.overlay.end.viewPoint.x -
                                viewerAiMaskBoxBinding.overlay.start.viewPoint.x,
                            ),
                          )}
                          height={Math.max(
                            0.1,
                            Math.abs(
                              viewerAiMaskBoxBinding.overlay.end.viewPoint.y -
                                viewerAiMaskBoxBinding.overlay.start.viewPoint.y,
                            ),
                          )}
                          stroke={canvasOverlayTokens.colors.active}
                          strokeWidth={2}
                          {...canvasOverlayShadowProps}
                          dash={[4, 4]}
                          listening={false}
                        />
                      )}
                      {isBrushActive && viewerBrushBinding.liveLine && (
                        <OptimizedBrushLine geometry={overlayGeometry} line={viewerBrushBinding.liveLine} />
                      )}
                      {isBrushActive && viewerBrushBinding.cursor.visible && (
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
                          x={viewerBrushBinding.cursor.x}
                          y={viewerBrushBinding.cursor.y}
                        />
                      )}
                      {viewerParametricMaskTargetOverlayPoint !== null && (
                        <Circle
                          fill="transparent"
                          listening={false}
                          radius={6}
                          stroke={canvasOverlayTokens.colors.active}
                          strokeScaleEnabled={false}
                          strokeWidth={2}
                          x={viewerParametricMaskTargetOverlayPoint.x}
                          y={viewerParametricMaskTargetOverlayPoint.y}
                          {...canvasOverlayShadowProps}
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
          descriptor={cropStraightenController.descriptor}
          handleCropComplete={cropStraightenController.handleCropComplete}
          isCropping={isCropping}
          isCropViewVisible={isCropViewVisible}
          onCropPreviewError={() => setLoadedCropPreviewUrl(null)}
          onCropPreviewLoad={() => setLoadedCropPreviewUrl(cropPreviewUrl)}
          isMaxZoom={isMaxZoom}
          isRotationActive={isRotationActive}
          isStraightenActive={isStraightenActive}
          isTemporaryHand={viewerInputState?.isTemporaryHand ?? false}
          overlayMode={overlayMode}
          overlayRotation={overlayRotation}
          setCrop={cropStraightenController.handleCropChange}
        />
      </ViewerSurface>
    );
  },
);

ImageCanvas.displayName = 'ImageCanvas';

export default ImageCanvas;
