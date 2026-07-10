import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Crop, PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import type { KonvaEventObject, Node as KonvaNode } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import type { Ellipse as KonvaEllipse } from 'konva/lib/shapes/Ellipse';
import type { Transformer as KonvaTransformer } from 'konva/lib/shapes/Transformer';
import type { Vector2d } from 'konva/lib/types';
import {
  Circle,
  Ellipse,
  Group,
  Text as KonvaText,
  Label,
  Layer,
  Line,
  Rect,
  Stage,
  Tag,
  Transformer,
} from 'react-konva';
import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import type { GamutWarningOverlayPayload } from '../../../schemas/tauriEventSchemas';
import type { EditorCompareMode, ExportSoftProofTransformState, InteractivePatch } from '../../../store/useEditorStore';
import { Invokes } from '../../../tauri/commands';
import type {
  Adjustments,
  AiPatch,
  Coord,
  MaskContainer,
  RetouchCloneSource,
  RetouchRemoveSource,
} from '../../../utils/adjustments';
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
import { globalImageCache } from '../../../utils/ImageLRUCache';
import {
  buildInteractivePreviewGeometryIdentity,
  InteractivePreviewUrlRegistry,
  isInteractivePreviewPatchCoherent,
} from '../../../utils/interactivePreviewPatch';
import {
  BRUSH_MASK_COMMAND_COORDINATE_SPACE,
  type BrushMaskCommandReceipt,
  buildBrushMaskCommandReceiptFromParameters,
} from '../../../utils/mask/brushMaskCommandBridge';
import {
  normalizeLinearGradientParameters,
  normalizeRadialGradientParameters,
} from '../../../utils/mask/gradientMaskParameters';
import { invokeWithSchema } from '../../../utils/tauriSchemaInvoke';
import {
  createViewerSampleRequest,
  isViewerSampleResultCurrent,
  LatestViewerSampleScheduler,
  mapViewerPointToImage,
  resolveViewerSampleTarget,
  type ViewerSampleRequest,
  type ViewerSampleResult,
  type ViewerSampleTarget,
  viewerSampleResultSchema,
} from '../../../utils/viewerSampler';
import { resolveWgpuPreviewVisibility } from '../../../utils/wgpuPreviewHealth';
import {
  averageWhiteBalancePickerRgbaSample,
  buildWhiteBalancePickerAdjustmentCommand,
  type WhiteBalancePickerRuntimeReceipt,
} from '../../../utils/whiteBalancePicker';
import type { AppSettings, BrushSettings, SelectedImage } from '../../ui/AppProperties';
import type { OverlayMode } from '../right/color/CropPanel';
import { Mask, type SubMask, SubMaskMode, ToolType } from '../right/layers/Masks';
import { CompareOverlay } from './CompareOverlay';
import { CropOverlaySurface } from './CropOverlaySurface';
import { imageCanvasLayerZIndex, resolveImageCanvasPointerOwner } from './imageCanvasContracts';
import {
  type CanvasOverlayStatus,
  canvasOverlayStatusColor,
  canvasOverlayTokens,
} from './overlays/canvasOverlayTokens';
import { PreviewSurface } from './PreviewSurface';
import { ViewerSamplerHud } from './ViewerSamplerHud';
import type { ViewerActiveTool } from './viewerInputResolver';

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

interface BrushPoint extends Coord {
  pressure?: number;
}

interface DrawnLine {
  brushSize: number;
  feather?: number;
  flow?: number;
  points: Array<BrushPoint>;
  tool: ToolType;
}

interface BrushMaskCommandCaptureSummary {
  commandId: string;
  commandType: 'layerMask.createBrushMask';
  commandHash: string;
  coordinateSpace: typeof BRUSH_MASK_COMMAND_COORDINATE_SPACE;
  expectedGraphRevision: string;
  imagePath: string;
  lastPointCount: number;
  lastStrokeMode: 'erase' | 'paint';
  maskId: string;
  operationId: string;
  pressurePointCount: number;
  receiptVersion: BrushMaskCommandReceipt['receiptVersion'];
  schemaVersion: BrushMaskCommandReceipt['schemaVersion'];
  strokeCount: number;
  validationStatus: BrushMaskCommandReceipt['validationStatus'];
}

interface MaskParameters {
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

interface RotateStart {
  angle: number;
  rotation: number;
}

interface StraightenLine {
  end: Vector2d;
  start: Vector2d;
}

type CanvasKonvaEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>;
type CanvasMoveEvent = CanvasKonvaEvent | MouseEvent | TouchEvent;
type RetouchHandleDragEvent = KonvaEventObject<DragEvent>;
type EditableKonvaEllipse = KonvaEllipse & {
  lastValidScaleX?: number;
  lastValidScaleY?: number;
};
type RetouchHandleKind = 'sourcePoint' | 'targetPoint';
const toMaskParameters = (parameters: SubMask['parameters']): MaskParameters => parameters as MaskParameters;

const isNonPrimaryButton = (event: CanvasKonvaEvent): boolean =>
  'button' in event.evt && typeof event.evt.button === 'number' && event.evt.button !== 0;

const isKonvaEvent = (event: CanvasMoveEvent): event is CanvasKonvaEvent => 'evt' in event && 'target' in event;

const setStageCursor = (stage: KonvaStage | null, cursor: string): void => {
  if (stage) {
    stage.container().style.cursor = cursor;
  }
};

const cssPx = (value: number | undefined): string => `${String(value ?? 0)}px`;
const cssPercent = (value: number): string => `${String(value)}%`;
const svgNumber = (value: number): string => String(value);
const getRemoveCanvasStatusColor = (status: RetouchRemoveSource['status']): string => {
  switch (status) {
    case 'ready':
      return canvasOverlayStatusColor('ready');
    case 'fallback_unchanged':
    case 'stale':
      return canvasOverlayStatusColor('stale');
    case 'needs_regeneration':
    case undefined:
      return canvasOverlayStatusColor('warning');
  }
};
const canvasOverlayShadowProps = {
  shadowBlur: canvasOverlayTokens.shadow.blur,
  shadowColor: canvasOverlayTokens.shadow.color,
  shadowOpacity: canvasOverlayTokens.shadow.opacity,
} as const;
const canvasOverlayLabelTextProps = {
  fill: canvasOverlayTokens.label.text,
  fontFamily: canvasOverlayTokens.label.fontFamily,
  fontSize: canvasOverlayTokens.label.fontSize,
  fontStyle: canvasOverlayTokens.label.fontStyle,
  padding: canvasOverlayTokens.label.padding,
} as const;
const getSubMaskCanvasStroke = (subMask: SubMask, isSelected: boolean): string => {
  if (isSelected) return canvasOverlayTokens.colors.active;
  switch (subMask.mode) {
    case SubMaskMode.Subtractive:
      return canvasOverlayTokens.colors.eraser;
    case SubMaskMode.Intersect:
      return canvasOverlayTokens.colors.gamut;
    default:
      return canvasOverlayTokens.colors.additive;
  }
};
const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};
const numberParameter = (parameters: SubMask['parameters'], key: string, fallback: number): number => {
  const value = parameters?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const normalizeLinearMaskParametersForLiveHandle = (parameters: MaskParameters): MaskParameters => ({
  ...parameters,
  ...normalizeLinearGradientParameters({
    endX: parameters.endX,
    endY: parameters.endY,
    range: parameters.range,
    startX: parameters.startX,
    startY: parameters.startY,
  }),
});
const normalizeLiveGradientRotation = (rotation: number): number => {
  if (!Number.isFinite(rotation)) return 0;
  return ((((rotation + 180) % 360) + 360) % 360) - 180;
};
const normalizeRadialMaskParametersForLiveHandle = (parameters: MaskParameters): MaskParameters => ({
  ...parameters,
  ...normalizeRadialGradientParameters({
    centerX: parameters.centerX,
    centerY: parameters.centerY,
    feather: typeof parameters['feather'] === 'number' ? parameters['feather'] : 0.5,
    radiusX: Math.abs(parameters.radiusX),
    radiusY: Math.abs(parameters.radiusY),
    rotation: normalizeLiveGradientRotation(parameters.rotation),
  }),
});

interface ImageCanvasProps {
  appSettings: AppSettings | null;
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  adjustments: Adjustments;
  brushSettings: BrushSettings | null;
  crop: Crop | null;
  exportSoftProofRecipeId: string | null;
  exportSoftProofTransform: ExportSoftProofTransformState | null;
  finalPreviewUrl: string | null;
  gamutWarningOverlay: GamutWarningOverlayPayload | null;
  handleCropComplete: (c: Crop, cp: PercentCrop) => void;
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
  onStraighten: (val: number) => void;
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
  uncroppedAdjustedPreviewUrl: string | null;
  updateSubMask: (id: string | null, subMask: Partial<SubMask>) => void;
  interactivePatch?: InteractivePatch | null;
  isWbPickerActive?: boolean;
  lastWhiteBalancePickerReceipt?: WhiteBalancePickerRuntimeReceipt | null;
  onWbPicked?: (receipt: WhiteBalancePickerRuntimeReceipt, nextAdjustments: Adjustments) => void;
  setAdjustments: (fn: (prev: Adjustments) => Adjustments) => void;
  overlayMode?: OverlayMode;
  overlayRotation?: number;
  cursorStyle: string;
  viewerInputState?: { activeTool: ViewerActiveTool; isTemporaryHand: boolean };
  isMaxZoom?: boolean;
  liveRotation?: number | null;
  transformState: { scale: number; positionX: number; positionY: number };
  hasRenderedFirstFrame: boolean;
  viewerSampleGraphRevision?: string;
}

interface MaskOverlay {
  geometry: EditorOverlayGeometry;
  onMaskInteractionEnd: () => void;
  onMaskInteractionStart: (event?: MaskInteractionEvent) => void;
  isToolActive: boolean;
  isSelected: boolean;
  onMaskMouseEnter: () => void;
  onMaskMouseLeave: () => void;
  onPreviewUpdate?: (id: string, subMask: Partial<SubMask>) => void;
  onSelect: () => void;
  onUpdate: (id: string, subMask: Partial<SubMask>) => void;
  subMask: SubMask;
  offsetX: number;
  offsetY: number;
  stageScale: number;
}

const getEdgeFadeStyle = (fadeDistancePx: number = 128): React.CSSProperties => ({
  WebkitMaskImage: `
    linear-gradient(to right, transparent, black ${cssPx(fadeDistancePx)}, black calc(100% - ${cssPx(fadeDistancePx)}), transparent),
    linear-gradient(to bottom, transparent, black ${cssPx(fadeDistancePx)}, black calc(100% - ${cssPx(fadeDistancePx)}), transparent)
  `,
  WebkitMaskComposite: 'source-in',
  maskImage: `
    linear-gradient(to right, transparent, black ${cssPx(fadeDistancePx)}, black calc(100% - ${cssPx(fadeDistancePx)}), transparent),
    linear-gradient(to bottom, transparent, black ${cssPx(fadeDistancePx)}, black calc(100% - ${cssPx(fadeDistancePx)}), transparent)
  `,
  maskComposite: 'intersect',
});

const OptimizedBrushLine = memo(({ geometry, line }: { geometry: EditorOverlayGeometry; line: DrawnLine }) => {
  const flattenedPoints = useMemo(() => {
    const pts = new Float32Array(line.points.length * 2);
    line.points.forEach((point, index) => {
      const viewPoint = geometry.cropToView(geometry.orientedToCrop(overlayPoint<'oriented-pixels'>(point.x, point.y)));
      pts[index * 2] = viewPoint.x;
      pts[index * 2 + 1] = viewPoint.y;
    });
    return Array.from(pts);
  }, [geometry, line.points]);

  return (
    <Line
      hitStrokeWidth={geometry.viewBrushWidthFromCrop(line.brushSize)}
      lineCap="round"
      lineJoin="round"
      points={flattenedPoints}
      stroke="transparent"
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
    />
  );
});

OptimizedBrushLine.displayName = 'OptimizedBrushLine';

const MaskOverlay = memo(
  ({
    geometry,
    onMaskInteractionEnd,
    onMaskInteractionStart,
    isToolActive,
    isSelected,
    onMaskMouseEnter,
    onMaskMouseLeave,
    onPreviewUpdate,
    onSelect,
    onUpdate,
    subMask,
    offsetX,
    offsetY,
    stageScale, // <-- Add this here
  }: MaskOverlay) => {
    const shapeRef = useRef<EditableKonvaEllipse | null>(null);
    const trRef = useRef<KonvaTransformer | null>(null);
    const rotateStartRef = useRef<RotateStart | null>(null);

    const scale = geometry.displayedImageRectInViewCssPixels.width / geometry.cropRectInOrientedPixels.width;
    const orientedToView = useCallback(
      (x: number, y: number): Coord =>
        geometry.cropToView(geometry.orientedToCrop(overlayPoint<'oriented-pixels'>(x, y))),
      [geometry],
    );
    const viewToOriented = useCallback(
      (x: number, y: number): Coord =>
        geometry.cropToOriented(geometry.viewToCrop(overlayPoint<'view-css-pixels'>(x, y))),
      [geometry],
    );
    const [p, setP] = useState<MaskParameters>(() => toMaskParameters(subMask.parameters));
    const pRef = useRef(p);
    const isDragging = useRef(false);
    const dragGeometryEpochRef = useRef<ReturnType<typeof captureGeometryEpoch> | null>(null);

    const dragStartPointer = useRef<Coord | null>(null);
    const dragStartParams = useRef<MaskParameters | null>(null);

    const getPointer = useCallback(
      (stage: KonvaStage | null): Coord | null => {
        if (!stage) return null;
        const pos = stage.getPointerPosition();
        if (!pos) return null;
        return { x: pos.x / stageScale - offsetX, y: pos.y / stageScale - offsetY };
      },
      [offsetX, offsetY, stageScale],
    );

    useEffect(() => {
      if (!isDragging.current) {
        const nextParameters = toMaskParameters(subMask.parameters);
        setP(nextParameters);
        pRef.current = nextParameters;
      }
    }, [subMask.parameters]);

    const updateP = useCallback((newP: MaskParameters) => {
      setP(newP);
      pRef.current = newP;
    }, []);
    const commitUpdate = useCallback(
      (id: string, patch: Partial<SubMask>) => {
        if (isDragging.current && !isGeometryEpochCurrent(dragGeometryEpochRef.current, geometry)) return;
        onUpdate(id, patch);
      },
      [geometry, onUpdate],
    );

    const handleMaskTouchStart = useCallback(
      (e: CanvasKonvaEvent) => {
        if (isNonPrimaryButton(e)) return;

        onMaskInteractionStart(e);
        if (e.evt.cancelable) e.evt.preventDefault();
        e.evt.stopPropagation();
      },
      [onMaskInteractionStart],
    );

    const handleMaskTouchEnd = useCallback(() => {
      onMaskInteractionEnd();
    }, [onMaskInteractionEnd]);

    const selectHandlers = isToolActive ? {} : { onClick: onSelect, onTap: onSelect };

    useEffect(() => {
      if (isSelected && trRef.current && shapeRef.current) {
        trRef.current.nodes([shapeRef.current]);
        trRef.current.getLayer()?.batchDraw();
      }
    }, [isSelected, isToolActive]);

    const lockDragBoundFunc = useCallback(function (this: KonvaNode): Vector2d {
      return this.getAbsolutePosition();
    }, []);

    const handleRadialDragStart = useCallback(
      (e: CanvasKonvaEvent) => {
        if (isNonPrimaryButton(e)) return;
        isDragging.current = true;
        dragGeometryEpochRef.current = captureGeometryEpoch(geometry);
        onMaskInteractionStart(e);
        dragStartPointer.current = getPointer(e.target.getStage());
        dragStartParams.current = { ...pRef.current };
      },
      [onMaskInteractionStart, getPointer],
    );

    const handleRadialDragMove = useCallback(
      (e: CanvasKonvaEvent) => {
        const pointerPos = getPointer(e.target.getStage());
        if (!pointerPos || !dragStartPointer.current || !dragStartParams.current) return;

        const currentPoint = viewToOriented(pointerPos.x, pointerPos.y);
        const startPoint = viewToOriented(dragStartPointer.current.x, dragStartPointer.current.y);
        const dx = currentPoint.x - startPoint.x;
        const dy = currentPoint.y - startPoint.y;

        const newP = normalizeRadialMaskParametersForLiveHandle({
          ...dragStartParams.current,
          centerX: dragStartParams.current.centerX + dx,
          centerY: dragStartParams.current.centerY + dy,
        });

        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });

        commitUpdate(subMask.id, { parameters: newP });
      },
      [viewToOriented, updateP, onPreviewUpdate, subMask.id, getPointer, commitUpdate],
    );

    const handleRadialDragEnd = useCallback(() => {
      const geometryIsCurrent = isGeometryEpochCurrent(dragGeometryEpochRef.current, geometry);
      isDragging.current = false;
      onMaskInteractionEnd();
      if (!geometryIsCurrent) return;
      commitUpdate(subMask.id, { parameters: pRef.current });
    }, [subMask.id, geometry, onMaskInteractionEnd, commitUpdate]);

    const handleRadialTransformStart = useCallback(
      (e: CanvasKonvaEvent) => {
        isDragging.current = true;
        dragGeometryEpochRef.current = captureGeometryEpoch(geometry);
        onMaskInteractionStart(e);
      },
      [geometry, onMaskInteractionStart],
    );

    const handleRadialTransform = useCallback(() => {
      const node = shapeRef.current;
      if (!node) return;

      const scaleX = Math.abs(node.scaleX());
      const scaleY = Math.abs(node.scaleY());

      if (pRef.current.radiusX * scaleX < 5 || pRef.current.radiusY * scaleY < 5) {
        node.scaleX(node.lastValidScaleX || 1);
        node.scaleY(node.lastValidScaleY || 1);
      } else {
        node.lastValidScaleX = scaleX;
        node.lastValidScaleY = scaleY;
      }

      const newRadiusX = pRef.current.radiusX * node.scaleX();
      const newRadiusY = pRef.current.radiusY * node.scaleY();
      const center = viewToOriented(node.x(), node.y());

      const newP = normalizeRadialMaskParametersForLiveHandle({
        ...pRef.current,
        centerX: center.x,
        centerY: center.y,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
        rotation: node.rotation() - geometry.rotationDegrees,
      });

      if (onPreviewUpdate) {
        onPreviewUpdate(subMask.id, { parameters: newP });
      }

      commitUpdate(subMask.id, { parameters: newP });
    }, [onPreviewUpdate, geometry.rotationDegrees, subMask.id, viewToOriented, commitUpdate]);

    const handleRadialTransformEnd = useCallback(() => {
      const node = shapeRef.current;
      if (!node) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      const newRadiusX = pRef.current.radiusX * scaleX;
      const newRadiusY = pRef.current.radiusY * scaleY;

      node.scaleX(1);
      node.scaleY(1);
      const center = viewToOriented(node.x(), node.y());

      const newP = normalizeRadialMaskParametersForLiveHandle({
        ...pRef.current,
        centerX: center.x,
        centerY: center.y,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
        rotation: node.rotation() - geometry.rotationDegrees,
      });

      const geometryIsCurrent = isGeometryEpochCurrent(dragGeometryEpochRef.current, geometry);
      updateP(newP);
      isDragging.current = false;
      onMaskInteractionEnd();
      if (!geometryIsCurrent) return;
      commitUpdate(subMask.id, { parameters: newP });
    }, [updateP, geometry, onMaskInteractionEnd, commitUpdate, subMask.id, viewToOriented]);

    const setRotateCursor = useCallback(
      (stage: KonvaStage, pointerPos: Coord) => {
        const center = orientedToView(pRef.current.centerX, pRef.current.centerY);
        const cx = center.x;
        const cy = center.y;
        const angle = Math.atan2(pointerPos.y - cy, pointerPos.x - cx) * (180 / Math.PI);

        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0px 1px 2px rgba(0,0,0,0.8));">
          <g transform="rotate(${svgNumber(Math.round(angle))} 16 16)">
            <path d="M 23 9 A 10 10 0 0 1 23 23" />
            <path d="M 28 9 L 23 9 L 23 14" />
            <path d="M 28 23 L 23 23 L 23 18" />
          </g>
        </svg>`;
        const encodedSvg = encodeURIComponent(svgStr);
        stage.container().style.cursor = `url('data:image/svg+xml;utf8,${encodedSvg}') 16 16, crosshair`;
      },
      [orientedToView],
    );

    const handleRotateStart = useCallback(
      (e: CanvasKonvaEvent) => {
        if (isNonPrimaryButton(e)) return;

        isDragging.current = true;
        dragGeometryEpochRef.current = captureGeometryEpoch(geometry);
        onMaskInteractionStart(e);
        e.cancelBubble = true;
        if (e.evt.cancelable) e.evt.preventDefault();

        const stage = e.target.getStage();
        const pointer = getPointer(stage);
        if (!pointer) return;

        const center = orientedToView(pRef.current.centerX, pRef.current.centerY);
        const cx = center.x;
        const cy = center.y;

        const startAngle = Math.atan2(pointer.y - cy, pointer.x - cx);
        rotateStartRef.current = {
          angle: startAngle,
          rotation: pRef.current.rotation || 0,
        };
      },
      [geometry, onMaskInteractionStart, getPointer, orientedToView],
    );

    const handleRotateMove = useCallback(
      (e: CanvasKonvaEvent) => {
        if (!rotateStartRef.current) return;
        const stage = e.target.getStage();
        const pointer = getPointer(stage);
        if (!stage || !pointer) return;

        setRotateCursor(stage, pointer);

        const center = orientedToView(pRef.current.centerX, pRef.current.centerY);
        const cx = center.x;
        const cy = center.y;

        const currentAngle = Math.atan2(pointer.y - cy, pointer.x - cx);
        const angleDiff = currentAngle - rotateStartRef.current.angle;
        const angleDiffDeg = (angleDiff * 180) / Math.PI;

        const newRotation = rotateStartRef.current.rotation + angleDiffDeg;

        const newP = normalizeRadialMaskParametersForLiveHandle({
          ...pRef.current,
          rotation: newRotation,
        });

        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
        commitUpdate(subMask.id, { parameters: newP });
      },
      [updateP, onPreviewUpdate, subMask.id, setRotateCursor, getPointer, orientedToView, commitUpdate],
    );

    const handleRotateEnd = useCallback(
      (e: CanvasKonvaEvent) => {
        const geometryIsCurrent = isGeometryEpochCurrent(dragGeometryEpochRef.current, geometry);
        isDragging.current = false;
        rotateStartRef.current = null;
        onMaskInteractionEnd();
        if (!geometryIsCurrent) return;
        commitUpdate(subMask.id, { parameters: pRef.current });

        setStageCursor(e.target.getStage(), '');
      },
      [geometry, subMask.id, onMaskInteractionEnd, commitUpdate],
    );

    const handleRotateHoverMove = useCallback(
      (e: CanvasKonvaEvent) => {
        if (isToolActive || isDragging.current) return;
        const stage = e.target.getStage();
        const pointer = getPointer(stage);
        if (stage && pointer) setRotateCursor(stage, pointer);
      },
      [isToolActive, setRotateCursor, getPointer],
    );

    const handleRotateMouseEnter = useCallback(
      (e: CanvasKonvaEvent) => {
        onMaskMouseEnter();
        if (!isToolActive && !isDragging.current) {
          const stage = e.target.getStage();
          const pointer = getPointer(stage);
          if (stage && pointer) setRotateCursor(stage, pointer);
        }
      },
      [onMaskMouseEnter, isToolActive, setRotateCursor, getPointer],
    );

    const handleRotateMouseLeave = useCallback(
      (e: CanvasKonvaEvent) => {
        onMaskMouseLeave();
        if (!isDragging.current) {
          setStageCursor(e.target.getStage(), '');
        }
      },
      [onMaskMouseLeave],
    );

    const handleLinearGroupDragStart = useCallback(
      (e: CanvasKonvaEvent) => {
        if (isNonPrimaryButton(e)) return;
        isDragging.current = true;
        dragGeometryEpochRef.current = captureGeometryEpoch(geometry);
        onMaskInteractionStart(e);
        dragStartPointer.current = getPointer(e.target.getStage());
        dragStartParams.current = { ...pRef.current };
        e.cancelBubble = true;
      },
      [geometry, onMaskInteractionStart, getPointer],
    );

    const handleLinearGroupDragMove = useCallback(
      (e: CanvasKonvaEvent) => {
        const pointerPos = getPointer(e.target.getStage());
        if (!pointerPos || !dragStartPointer.current || !dragStartParams.current) return;

        const currentPoint = viewToOriented(pointerPos.x, pointerPos.y);
        const startPoint = viewToOriented(dragStartPointer.current.x, dragStartPointer.current.y);
        const dx = currentPoint.x - startPoint.x;
        const dy = currentPoint.y - startPoint.y;

        const newP = normalizeLinearMaskParametersForLiveHandle({
          ...dragStartParams.current,
          startX: dragStartParams.current.startX + dx,
          startY: dragStartParams.current.startY + dy,
          endX: dragStartParams.current.endX + dx,
          endY: dragStartParams.current.endY + dy,
        });

        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
        commitUpdate(subMask.id, { parameters: newP });
      },
      [viewToOriented, updateP, onPreviewUpdate, subMask.id, getPointer, commitUpdate],
    );

    const handleLinearGroupDragEnd = useCallback(
      (e: CanvasKonvaEvent) => {
        const geometryIsCurrent = isGeometryEpochCurrent(dragGeometryEpochRef.current, geometry);
        isDragging.current = false;
        e.cancelBubble = true;
        onMaskInteractionEnd();
        if (!geometryIsCurrent) return;
        commitUpdate(subMask.id, { parameters: pRef.current });
      },
      [geometry, subMask.id, onMaskInteractionEnd, commitUpdate],
    );

    const handleLinearPointDragStart = useCallback(
      (e: CanvasKonvaEvent) => {
        if (isNonPrimaryButton(e)) return;
        isDragging.current = true;
        dragGeometryEpochRef.current = captureGeometryEpoch(geometry);
        onMaskInteractionStart(e);
        e.cancelBubble = true;
      },
      [geometry, onMaskInteractionStart],
    );

    const handleLinearPointDragMove = useCallback(
      (e: CanvasKonvaEvent, pointType: 'end' | 'start') => {
        const stage = e.target.getStage();
        const pointerPos = getPointer(stage);
        if (!pointerPos) return;

        const orientedPoint = viewToOriented(pointerPos.x, pointerPos.y);
        const newX = orientedPoint.x;
        const newY = orientedPoint.y;

        const nextP = { ...pRef.current };
        if (pointType === 'start') {
          nextP.startX = newX;
          nextP.startY = newY;
        } else {
          nextP.endX = newX;
          nextP.endY = newY;
        }
        const newP = normalizeLinearMaskParametersForLiveHandle(nextP);
        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
        commitUpdate(subMask.id, { parameters: newP });
      },
      [viewToOriented, updateP, onPreviewUpdate, subMask.id, getPointer, commitUpdate],
    );

    const handleLinearRangeDragMove = useCallback(
      (e: CanvasKonvaEvent) => {
        const stage = e.target.getStage();
        const pointerPos = getPointer(stage);
        if (!pointerPos) return;

        const { startX, startY, endX, endY } = pRef.current;
        const start = orientedToView(startX, startY);
        const end = orientedToView(endX, endY);
        const sX = start.x;
        const sY = start.y;
        const eX = end.x;
        const eY = end.y;

        const dx = eX - sX;
        const dy = eY - sY;
        const len = Math.sqrt(dx * dx + dy * dy);

        let newRange = pRef.current.range;
        if (len > 0) {
          const dist = Math.abs(dx * (sY - pointerPos.y) - (sX - pointerPos.x) * dy) / len;
          newRange = Math.max(0.1, dist / scale);
        }

        const newP = normalizeLinearMaskParametersForLiveHandle({ ...pRef.current, range: newRange });
        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });

        commitUpdate(subMask.id, { parameters: newP });
      },
      [scale, updateP, onPreviewUpdate, subMask.id, getPointer, orientedToView, commitUpdate],
    );

    const handleLinearPointDragEnd = useCallback(
      (e: CanvasKonvaEvent) => {
        const geometryIsCurrent = isGeometryEpochCurrent(dragGeometryEpochRef.current, geometry);
        isDragging.current = false;
        e.cancelBubble = true;
        onMaskInteractionEnd();
        if (!geometryIsCurrent) return;
        commitUpdate(subMask.id, { parameters: pRef.current });
      },
      [geometry, subMask.id, onMaskInteractionEnd, commitUpdate],
    );

    if (!subMask.visible) {
      return null;
    }

    const commonProps = {
      dash: [4, 4],
      ...selectHandlers,
      opacity: isSelected ? 1 : canvasOverlayTokens.stroke.inactiveOpacity,
      stroke: getSubMaskCanvasStroke(subMask, isSelected),
      strokeScaleEnabled: false,
      strokeWidth: isSelected ? canvasOverlayTokens.stroke.selectedWidth : canvasOverlayTokens.stroke.width,
      ...canvasOverlayShadowProps,
    };

    if (subMask.type === Mask.AiSubject || subMask.type === Mask.QuickEraser) {
      const { startX, startY, endX, endY } = p;
      const start = orientedToView(startX, startY);
      const end = orientedToView(endX, endY);
      const isPoint = Math.abs(startX - endX) < 1e-6 && Math.abs(startY - endY) < 1e-6;
      if (isPoint) {
        return (
          <Circle
            x={start.x}
            y={start.y}
            radius={5}
            stroke={getSubMaskCanvasStroke(subMask, isSelected)}
            strokeWidth={2}
            listening={!isToolActive}
            {...selectHandlers}
            onTouchEnd={handleMaskTouchEnd}
            onTouchStart={handleMaskTouchStart}
            onMouseEnter={onMaskMouseEnter}
            onMouseLeave={onMaskMouseLeave}
            fill={isSelected ? canvasOverlayTokens.colors.activeFill : 'rgba(0, 0, 0, 0.08)'}
            {...canvasOverlayShadowProps}
          />
        );
      }
      return (
        <Rect
          height={Math.max(0.1, Math.abs(end.y - start.y))}
          onMouseEnter={onMaskMouseEnter}
          onMouseLeave={onMaskMouseLeave}
          onTouchEnd={handleMaskTouchEnd}
          onTouchStart={handleMaskTouchStart}
          width={Math.max(0.1, Math.abs(end.x - start.x))}
          x={Math.min(start.x, end.x)}
          y={Math.min(start.y, end.y)}
          {...commonProps}
        />
      );
    }

    if (subMask.type === Mask.Brush || subMask.type === Mask.Flow) {
      const { lines = [] } = p;
      return (
        <Group {...selectHandlers} onTouchEnd={handleMaskTouchEnd} onTouchStart={handleMaskTouchStart}>
          {lines.map((line: DrawnLine, i: number) => (
            <OptimizedBrushLine geometry={geometry} key={i} line={line} />
          ))}
        </Group>
      );
    }

    if (subMask.type === Mask.Radial) {
      const { centerX, centerY, radiusX, radiusY, rotation } = p;
      const center = orientedToView(centerX, centerY);
      if (p.isInitialDraw && (radiusX < 1 || radiusY < 2)) return null;

      return (
        <Group>
          {isSelected && !isToolActive && (
            <Ellipse
              x={center.x}
              y={center.y}
              radiusX={Math.max(0.1, radiusX * scale) + 35}
              radiusY={Math.max(0.1, radiusY * scale) + 35}
              rotation={rotation + geometry.rotationDegrees}
              fill="transparent"
              draggable
              dragBoundFunc={lockDragBoundFunc}
              onDragStart={handleRotateStart}
              onDragMove={handleRotateMove}
              onDragEnd={handleRotateEnd}
              onMouseEnter={handleRotateMouseEnter}
              onMouseMove={handleRotateHoverMove}
              onMouseLeave={handleRotateMouseLeave}
              onTouchStart={handleRotateStart}
              onTouchMove={handleRotateMove}
              onTouchEnd={handleRotateEnd}
            />
          )}

          <Ellipse
            {...commonProps}
            ref={shapeRef}
            fill="transparent"
            draggable={!isToolActive}
            dragBoundFunc={lockDragBoundFunc}
            onDragStart={handleRadialDragStart}
            onDragMove={handleRadialDragMove}
            onDragEnd={handleRadialDragEnd}
            onMouseEnter={(e: CanvasKonvaEvent) => {
              onMaskMouseEnter();
              if (!isToolActive && !isDragging.current) {
                setStageCursor(e.target.getStage(), 'move');
              }
            }}
            onMouseLeave={(e: CanvasKonvaEvent) => {
              onMaskMouseLeave();
              if (!isDragging.current) {
                setStageCursor(e.target.getStage(), '');
              }
            }}
            onTouchEnd={handleMaskTouchEnd}
            onTouchStart={handleMaskTouchStart}
            radiusX={Math.max(0.1, radiusX * scale)}
            radiusY={Math.max(0.1, radiusY * scale)}
            rotation={rotation + geometry.rotationDegrees}
            x={center.x}
            y={center.y}
          />
          {isSelected && !isToolActive && (
            <Transformer
              ref={trRef}
              centeredScaling={true}
              rotateEnabled={false}
              enabledAnchors={[
                'top-left',
                'top-right',
                'bottom-left',
                'bottom-right',
                'top-center',
                'bottom-center',
                'middle-left',
                'middle-right',
              ]}
              onMouseDown={(e) => {
                if (isNonPrimaryButton(e)) return;
                e.cancelBubble = true;
                e.evt.preventDefault();
              }}
              onTouchStart={(e) => {
                handleMaskTouchStart(e);
                e.cancelBubble = true;
                e.evt.preventDefault();
              }}
              onTouchEnd={handleMaskTouchEnd}
              boundBoxFunc={(oldBox, newBox) => {
                if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                  return oldBox;
                }
                return newBox;
              }}
              onTransformStart={handleRadialTransformStart}
              onTransform={handleRadialTransform}
              onTransformEnd={handleRadialTransformEnd}
              onMouseEnter={onMaskMouseEnter}
              onMouseLeave={onMaskMouseLeave}
            />
          )}
        </Group>
      );
    }

    if (subMask.type === Mask.Linear) {
      const { startX, startY, endX, endY, range } = p;

      const flickDistX = startX - endX;
      const flickDistY = startY - endY;
      if (p.isInitialDraw && Math.sqrt(flickDistX * flickDistX + flickDistY * flickDistY) < 1) return null;

      const start = orientedToView(startX, startY);
      const end = orientedToView(endX, endY);
      const sX = start.x;
      const sY = start.y;
      const eX = end.x;
      const eY = end.y;
      const r = range * scale;

      const idx = eX - sX;
      const idy = eY - sY;
      const angle = Math.atan2(idy, idx);
      const angleDeg = (angle * 180) / Math.PI;

      const centerX = sX + (eX - sX) / 2;
      const centerY = sY + (eY - sY) / 2;

      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      const dx_norm = Math.cos(angle);
      const dy_norm = Math.sin(angle);

      const EXT = 5000;
      const topRangePts = [
        sX + nx * r - dx_norm * EXT,
        sY + ny * r - dy_norm * EXT,
        eX + nx * r + dx_norm * EXT,
        eY + ny * r + dy_norm * EXT,
      ];
      const botRangePts = [
        sX - nx * r - dx_norm * EXT,
        sY - ny * r - dy_norm * EXT,
        eX - nx * r + dx_norm * EXT,
        eY - ny * r + dy_norm * EXT,
      ];

      const lineProps = {
        ...commonProps,
        strokeWidth: isSelected ? 2.5 : 2,
        dash: [6, 6],
        hitStrokeWidth: 40,
      };

      const showFeatherLines = isSelected && (!isToolActive || p.isInitialDraw);

      return (
        <Group>
          <Group
            x={centerX}
            y={centerY}
            rotation={angleDeg}
            draggable={isSelected && !isToolActive}
            dragBoundFunc={lockDragBoundFunc}
            onDragStart={handleLinearGroupDragStart}
            onDragMove={handleLinearGroupDragMove}
            onDragEnd={handleLinearGroupDragEnd}
            {...selectHandlers}
            onTouchEnd={handleMaskTouchEnd}
            onTouchStart={handleMaskTouchStart}
            onMouseEnter={(e: CanvasKonvaEvent) => {
              onMaskMouseEnter();
              if (!isToolActive) setStageCursor(e.target.getStage(), 'move');
            }}
            onMouseLeave={(e: CanvasKonvaEvent) => {
              onMaskMouseLeave();
              setStageCursor(e.target.getStage(), '');
            }}
          >
            <Line points={[-5000, 0, 5000, 0]} {...lineProps} dash={[2, 3]} />
          </Group>

          {showFeatherLines && (
            <>
              <Line
                points={topRangePts}
                {...lineProps}
                draggable={!isToolActive}
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={handleLinearRangeDragMove}
                onDragEnd={handleLinearPointDragEnd}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: CanvasKonvaEvent) => {
                  onMaskMouseEnter();
                  if (!isToolActive) setStageCursor(e.target.getStage(), 'row-resize');
                }}
                onMouseLeave={(e: CanvasKonvaEvent) => {
                  onMaskMouseLeave();
                  setStageCursor(e.target.getStage(), '');
                }}
              />
              <Line
                points={botRangePts}
                {...lineProps}
                draggable={!isToolActive}
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={handleLinearRangeDragMove}
                onDragEnd={handleLinearPointDragEnd}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: CanvasKonvaEvent) => {
                  onMaskMouseEnter();
                  if (!isToolActive) setStageCursor(e.target.getStage(), 'row-resize');
                }}
                onMouseLeave={(e: CanvasKonvaEvent) => {
                  onMaskMouseLeave();
                  setStageCursor(e.target.getStage(), '');
                }}
              />
            </>
          )}

          {isSelected && !isToolActive && (
            <>
              <Circle
                x={sX}
                y={sY}
                radius={8 / stageScale}
                fill={canvasOverlayTokens.colors.active}
                stroke={canvasOverlayTokens.colors.neutral}
                strokeWidth={2 / stageScale}
                {...canvasOverlayShadowProps}
                draggable
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={(e) => {
                  handleLinearPointDragMove(e, 'start');
                }}
                onDragEnd={handleLinearPointDragEnd}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: CanvasKonvaEvent) => {
                  onMaskMouseEnter();
                  setStageCursor(e.target.getStage(), 'grab');
                }}
                onMouseLeave={(e: CanvasKonvaEvent) => {
                  onMaskMouseLeave();
                  setStageCursor(e.target.getStage(), '');
                }}
              />
              <Circle
                x={eX}
                y={eY}
                radius={8 / stageScale}
                fill={canvasOverlayTokens.colors.active}
                stroke={canvasOverlayTokens.colors.neutral}
                strokeWidth={2 / stageScale}
                {...canvasOverlayShadowProps}
                draggable
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={(e) => {
                  handleLinearPointDragMove(e, 'end');
                }}
                onDragEnd={handleLinearPointDragEnd}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: CanvasKonvaEvent) => {
                  onMaskMouseEnter();
                  setStageCursor(e.target.getStage(), 'grab');
                }}
                onMouseLeave={(e: CanvasKonvaEvent) => {
                  onMaskMouseLeave();
                  setStageCursor(e.target.getStage(), '');
                }}
              />
            </>
          )}

          {!isSelected && (
            <>
              <Line
                points={topRangePts}
                {...lineProps}
                opacity={0.7}
                stroke={canvasOverlayTokens.colors.neutral}
                listening={true}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: CanvasKonvaEvent) => {
                  onMaskMouseEnter();
                  if (!isToolActive) setStageCursor(e.target.getStage(), 'row-resize');
                }}
                onMouseLeave={(e: CanvasKonvaEvent) => {
                  onMaskMouseLeave();
                  setStageCursor(e.target.getStage(), '');
                }}
              />
              <Line
                points={botRangePts}
                {...lineProps}
                opacity={0.7}
                stroke={canvasOverlayTokens.colors.neutral}
                listening={true}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: CanvasKonvaEvent) => {
                  onMaskMouseEnter();
                  if (!isToolActive) setStageCursor(e.target.getStage(), 'row-resize');
                }}
                onMouseLeave={(e: CanvasKonvaEvent) => {
                  onMaskMouseLeave();
                  setStageCursor(e.target.getStage(), '');
                }}
              />
            </>
          )}
        </Group>
      );
    }

    if (subMask.type === Mask.Color || subMask.type === Mask.Luminance) {
      const { targetX, targetY } = p;
      if (targetX >= 0 && targetY >= 0) {
        const target = orientedToView(targetX, targetY);
        return (
          <Circle
            x={target.x}
            y={target.y}
            radius={5}
            stroke={getSubMaskCanvasStroke(subMask, isSelected)}
            strokeWidth={2}
            listening={false}
            onTouchEnd={handleMaskTouchEnd}
            onTouchStart={handleMaskTouchStart}
            fill={isSelected ? canvasOverlayTokens.colors.activeFill : 'rgba(0, 0, 0, 0.08)'}
            {...canvasOverlayShadowProps}
          />
        );
      }
      return null;
    }
    return null;
  },
);

MaskOverlay.displayName = 'MaskOverlay';

interface PreviewLayerValue {
  url: string;
}

interface SvgPreviewLayer<T extends PreviewLayerValue> {
  id: string;
  opacity: 0 | 1;
  owner: string;
  status: 'loaded' | 'loading' | 'visible';
  value: T;
}

interface SvgPreviewHandoffState<T extends PreviewLayerValue> {
  active: SvgPreviewLayer<T> | null;
  retired: SvgPreviewLayer<T>[];
  retiringActiveId: string | null;
  scopeKey: string;
  successor: SvgPreviewLayer<T> | null;
}

interface SvgPreviewHandoffOptions<T extends PreviewLayerValue> {
  initiallyVisible: boolean;
  ownerPrefix: string;
  retainActiveWithoutTarget: boolean;
  scopeKey: string;
  target: T | null;
  targetKey: string | null;
  reducedMotion: boolean;
  onClaim: (owner: string, url: string) => void;
  onRelease: (owner: string, url: string) => void;
}

const createSvgPreviewLayer = <T extends PreviewLayerValue>(
  ownerPrefix: string,
  scopeKey: string,
  value: T,
  opacity: 0 | 1,
): SvgPreviewLayer<T> => ({
  id: value.url,
  opacity,
  owner: `${ownerPrefix}:${scopeKey}:${value.url}`,
  status: 'loading',
  value,
});

const activeLayersForSvgPreviewHandoff = <T extends PreviewLayerValue>(state: SvgPreviewHandoffState<T>) => [
  ...(state.active ? [state.active] : []),
  ...(state.successor ? [state.successor] : []),
];

const layersForSvgPreviewHandoff = <T extends PreviewLayerValue>(state: SvgPreviewHandoffState<T>) => [
  ...activeLayersForSvgPreviewHandoff(state),
  ...state.retired,
];

const settleSvgPreviewSuccessor = <T extends PreviewLayerValue>(
  state: SvgPreviewHandoffState<T>,
  successorId: string,
): SvgPreviewHandoffState<T> => {
  if (state.successor?.id !== successorId) return state;
  return {
    ...state,
    active: { ...state.successor, opacity: 1, status: 'visible' },
    retired: state.active ? [...state.retired, state.active] : state.retired,
    retiringActiveId: null,
    successor: null,
  };
};

function useSvgPreviewHandoff<T extends PreviewLayerValue>({
  initiallyVisible,
  onClaim,
  onRelease,
  ownerPrefix,
  reducedMotion,
  retainActiveWithoutTarget,
  scopeKey,
  target,
  targetKey,
}: SvgPreviewHandoffOptions<T>) {
  const [state, setState] = useState<SvgPreviewHandoffState<T>>(() => ({
    active: initiallyVisible && target ? createSvgPreviewLayer(ownerPrefix, scopeKey, target, 1) : null,
    retired: [],
    retiringActiveId: null,
    scopeKey,
    successor: !initiallyVisible && target ? createSvgPreviewLayer(ownerPrefix, scopeKey, target, 0) : null,
  }));
  const onClaimRef = useRef(onClaim);
  const onReleaseRef = useRef(onRelease);
  const ownedLayersRef = useRef<SvgPreviewLayer<T>[]>([]);

  useLayoutEffect(() => {
    onClaimRef.current = onClaim;
    onReleaseRef.current = onRelease;
  }, [onClaim, onRelease]);

  useLayoutEffect(() => {
    setState((current) => {
      if (current.scopeKey !== scopeKey) {
        return {
          active: initiallyVisible && target ? createSvgPreviewLayer(ownerPrefix, scopeKey, target, 1) : null,
          retired: [...current.retired, ...activeLayersForSvgPreviewHandoff(current)],
          retiringActiveId: null,
          scopeKey,
          successor: !initiallyVisible && target ? createSvgPreviewLayer(ownerPrefix, scopeKey, target, 0) : null,
        };
      }

      if (!target) {
        if (retainActiveWithoutTarget) return current;
        return {
          ...current,
          active: null,
          retired: [...current.retired, ...activeLayersForSvgPreviewHandoff(current)],
          retiringActiveId: null,
          successor: null,
        };
      }

      if (current.successor?.id === target.url || (current.active?.id === target.url && !current.successor)) {
        return current;
      }

      const staleSuccessor = current.successor ? [current.successor] : [];
      if (!current.active) {
        return {
          ...current,
          retired: [...current.retired, ...staleSuccessor],
          successor: createSvgPreviewLayer(ownerPrefix, scopeKey, target, 0),
        };
      }

      return {
        ...current,
        retired: [...current.retired, ...staleSuccessor],
        successor: createSvgPreviewLayer(ownerPrefix, scopeKey, target, 0),
      };
    });
  }, [initiallyVisible, ownerPrefix, retainActiveWithoutTarget, scopeKey, target, targetKey]);

  useLayoutEffect(() => {
    const ownedLayers = layersForSvgPreviewHandoff(state);
    ownedLayersRef.current = ownedLayers;
    for (const layer of ownedLayers) {
      if (!state.retired.includes(layer)) {
        onClaimRef.current(layer.owner, layer.value.url);
      }
    }
  }, [state]);

  useEffect(() => {
    if (state.retired.length === 0) return;
    for (const layer of state.retired) {
      onReleaseRef.current(layer.owner, layer.value.url);
    }
    setState((current) => (current.retired === state.retired ? { ...current, retired: [] } : current));
  }, [state.retired]);

  useEffect(
    () => () => {
      for (const layer of ownedLayersRef.current) {
        onReleaseRef.current(layer.owner, layer.value.url);
      }
    },
    [],
  );

  const settleSuccessor = useCallback((successorId: string) => {
    setState((current) => settleSvgPreviewSuccessor(current, successorId));
  }, []);

  const handleSuccessorLoad = useCallback((successorId: string) => {
    setState((current) => {
      if (current.successor?.id !== successorId || current.successor.status !== 'loading') return current;
      return { ...current, successor: { ...current.successor, status: 'loaded' } };
    });
  }, []);

  const handleSuccessorError = useCallback((successorId: string) => {
    setState((current) => {
      if (current.successor?.id !== successorId) return current;
      return { ...current, retired: [...current.retired, current.successor], successor: null };
    });
  }, []);

  useEffect(() => {
    const successor = state.successor;
    if (!successor || successor.status !== 'loaded') return;

    let frame2: number | null = null;
    const frame1 = requestAnimationFrame(() => {
      setState((current) => {
        if (current.successor?.id !== successor.id) return current;
        return { ...current, successor: { ...current.successor, opacity: 1, status: 'visible' } };
      });
      if (reducedMotion) {
        frame2 = requestAnimationFrame(() => {
          settleSuccessor(successor.id);
        });
      }
    });

    return () => {
      cancelAnimationFrame(frame1);
      if (frame2 !== null) cancelAnimationFrame(frame2);
    };
  }, [reducedMotion, settleSuccessor, state.successor]);

  const beginActiveRetirement = useCallback(() => {
    setState((current) => {
      const retiredSuccessor = current.successor ? [current.successor] : [];
      if (!current.active) {
        return retiredSuccessor.length > 0
          ? { ...current, retired: [...current.retired, ...retiredSuccessor], successor: null }
          : current;
      }
      if (current.retiringActiveId === current.active.id && !current.successor) return current;
      return {
        ...current,
        active: { ...current.active, opacity: 0 },
        retired: [...current.retired, ...retiredSuccessor],
        retiringActiveId: current.active.id,
        successor: null,
      };
    });
  }, []);

  const retireActive = useCallback((activeId: string) => {
    setState((current) => {
      if (current.active?.id !== activeId || current.retiringActiveId !== activeId) return current;
      return {
        ...current,
        active: null,
        retired: [...current.retired, current.active],
        retiringActiveId: null,
      };
    });
  }, []);

  useEffect(() => {
    const activeId = state.retiringActiveId;
    if (!reducedMotion || !activeId) return;

    let frame2: number | null = null;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        retireActive(activeId);
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      if (frame2 !== null) cancelAnimationFrame(frame2);
    };
  }, [reducedMotion, retireActive, state.retiringActiveId]);

  const handleTransitionEnd = useCallback((layerId: string) => {
    setState((current) => {
      if (current.successor?.id === layerId) return settleSvgPreviewSuccessor(current, layerId);
      if (current.active?.id === layerId && current.retiringActiveId === layerId) {
        return {
          ...current,
          active: null,
          retired: [...current.retired, current.active],
          retiringActiveId: null,
        };
      }
      return current;
    });
  }, []);

  return { beginActiveRetirement, handleSuccessorError, handleSuccessorLoad, handleTransitionEnd, state };
}

const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateReducedMotion = () => setReducedMotion(mediaQuery.matches);
    updateReducedMotion();
    mediaQuery.addEventListener('change', updateReducedMotion);
    return () => {
      mediaQuery.removeEventListener('change', updateReducedMotion);
    };
  }, []);

  return reducedMotion;
};

interface SvgPreviewHandoffProps {
  baseScopeKey: string;
  baseSource: string | null;
  incomingPatch: InteractivePatch | null;
  isCpuPreviewVisible: boolean;
  isMaxZoom: boolean | undefined;
  patchScopeKey: string;
  reducedMotion?: boolean | undefined;
  releaseUrl: (owner: string, url: string) => void;
  retainUrl: (owner: string, url: string) => void;
}

export function SvgPreviewHandoff({
  baseScopeKey,
  baseSource,
  incomingPatch,
  isCpuPreviewVisible,
  isMaxZoom,
  patchScopeKey,
  reducedMotion: reducedMotionOverride,
  releaseUrl,
  retainUrl,
}: SvgPreviewHandoffProps) {
  const reducedMotionPreference = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? reducedMotionPreference;
  const baseTarget = useMemo(() => (baseSource ? { url: baseSource } : null), [baseSource]);
  const baseHandoff = useSvgPreviewHandoff({
    initiallyVisible: true,
    onClaim: retainUrl,
    onRelease: releaseUrl,
    ownerPrefix: 'base',
    reducedMotion,
    retainActiveWithoutTarget: false,
    scopeKey: baseScopeKey,
    target: baseTarget,
    targetKey: baseSource,
  });
  const patchHandoff = useSvgPreviewHandoff({
    initiallyVisible: false,
    onClaim: retainUrl,
    onRelease: releaseUrl,
    ownerPrefix: 'patch',
    reducedMotion,
    retainActiveWithoutTarget: true,
    scopeKey: patchScopeKey,
    target: incomingPatch,
    targetKey: incomingPatch?.url ?? null,
  });
  const baseSuccessorIsVisible = baseHandoff.state.successor?.opacity === 1;

  useEffect(() => {
    if (!incomingPatch && baseSuccessorIsVisible) {
      patchHandoff.beginActiveRetirement();
    }
  }, [baseSuccessorIsVisible, incomingPatch, patchHandoff.beginActiveRetirement]);

  if (!isCpuPreviewVisible) return null;

  const imageRendering = isMaxZoom ? 'pixelated' : 'auto';
  const transition = reducedMotion ? undefined : 'opacity 150ms ease-in-out';
  const baseLayers = [
    ...(baseHandoff.state.active ? [baseHandoff.state.active] : []),
    ...(baseHandoff.state.successor ? [baseHandoff.state.successor] : []),
  ];
  const patchLayers = [
    ...(patchHandoff.state.active ? [patchHandoff.state.active] : []),
    ...(patchHandoff.state.successor ? [patchHandoff.state.successor] : []),
  ];

  return (
    <>
      {baseLayers.map((layer) => (
        <image
          data-preview-layer-id={layer.id}
          data-testid="svg-preview-base-layer"
          height="100%"
          href={layer.value.url}
          key={`base:${layer.owner}`}
          onError={() => baseHandoff.handleSuccessorError(layer.id)}
          onLoad={() => baseHandoff.handleSuccessorLoad(layer.id)}
          onTransitionEnd={(event) => {
            if (event.propertyName === 'opacity') baseHandoff.handleTransitionEnd(layer.id);
          }}
          style={{ imageRendering, opacity: layer.opacity, transition }}
          width="100%"
          x="0"
          y="0"
        />
      ))}
      {patchLayers.map((layer) => (
        <image
          data-preview-layer-id={layer.id}
          data-testid="svg-preview-patch-layer"
          height={cssPercent(layer.value.normH * 100)}
          href={layer.value.url}
          key={`patch:${layer.owner}`}
          onError={() => patchHandoff.handleSuccessorError(layer.id)}
          onLoad={() => patchHandoff.handleSuccessorLoad(layer.id)}
          onTransitionEnd={(event) => {
            if (event.propertyName === 'opacity') patchHandoff.handleTransitionEnd(layer.id);
          }}
          preserveAspectRatio="none"
          style={{ imageRendering, opacity: layer.opacity, transition }}
          width={cssPercent(layer.value.normW * 100)}
          x={cssPercent(layer.value.normX * 100)}
          y={cssPercent(layer.value.normY * 100)}
        />
      ))}
    </>
  );
}

const ImageCanvas = memo(
  ({
    appSettings,
    activeAiPatchContainerId,
    activeAiSubMaskId,
    activeMaskContainerId,
    activeMaskId,
    adjustments,
    brushSettings,
    crop,
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    finalPreviewUrl,
    gamutWarningOverlay,
    handleCropComplete,
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
    uncroppedAdjustedPreviewUrl,
    updateSubMask,
    isWbPickerActive = false,
    lastWhiteBalancePickerReceipt,
    onWbPicked,
    setAdjustments,
    overlayRotation,
    overlayMode,
    cursorStyle,
    viewerInputState,
    isMaxZoom,
    liveRotation,
    transformState,
    hasRenderedFirstFrame,
    viewerSampleGraphRevision = 'viewer-sample-unbound',
  }: ImageCanvasProps) => {
    const { t } = useTranslation();
    const [isCropViewVisible, setIsCropViewVisible] = useState(false);
    const cropImageRef = useRef<HTMLImageElement>(null);
    const [displayedMaskUrl, setDisplayedMaskUrl] = useState<string | null>(null);
    const [originalLoaded, setOriginalLoaded] = useState<boolean>(false);
    const [originalLoadFailed, setOriginalLoadFailed] = useState(false);
    const [localInitialDrawParams, setLocalInitialDrawParams] = useState<MaskParameters | null>(null);
    const [isMaskInteractionActive, setIsMaskInteractionActive] = useState(false);
    const isDrawing = useRef(false);
    const drawingStageRef = useRef<KonvaStage | null>(null);
    const dragStartPointer = useRef<Coord | null>(null);
    const pointerGeometryEpochRef = useRef<ReturnType<typeof captureGeometryEpoch> | null>(null);
    const lastBrushPoint = useRef<Coord | null>(null);
    const currentLine = useRef<DrawnLine | null>(null);
    const previewBoxRef = useRef<{ start: Coord; end: Coord } | null>(null);
    const [previewBox, setPreviewBox] = useState<{ start: Coord; end: Coord } | null>(null);

    const [cursorPreview, setCursorPreview] = useState<CursorPreview>({ x: 0, y: 0, visible: false });
    const [liveBrushLine, setLiveBrushLine] = useState<DrawnLine | null>(null);
    const [straightenLine, setStraightenLine] = useState<StraightenLine | null>(null);
    const isStraightening = useRef(false);
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
      thumbnailUrl: selectedImage.thumbnailUrl,
    });

    const [interactivePreviewUrlRegistry] = useState(() => new InteractivePreviewUrlRegistry());

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

    const [baseTool, setBaseTool] = useState<ToolType>(brushSettings?.tool ?? ToolType.Brush);
    const [isAltPressed, setIsAltPressed] = useState(false);
    const [lastBrushCommandCapture, setLastBrushCommandCapture] = useState<BrushMaskCommandCaptureSummary | null>(null);

    const wgpuPreviewVisibility = resolveWgpuPreviewVisibility({
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
      setBaseTool(brushSettings?.tool ?? ToolType.Brush);
    }, [brushSettings?.tool]);

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
    const withPointerPressure = useCallback((point: Coord, event: unknown): BrushPoint => {
      const pointerEvent = event as { pointerType?: unknown; pressure?: unknown };
      if (pointerEvent.pointerType === 'mouse' || typeof pointerEvent.pressure !== 'number') {
        return point;
      }

      return {
        ...point,
        pressure: Math.max(0, Math.min(1, pointerEvent.pressure)),
      };
    }, []);

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
    const recordBrushMaskCommandCapture = useCallback(
      (subMaskId: string | null, subMask: SubMask | null, parameters: MaskParameters) => {
        if (!subMaskId || !subMask || (subMask.type !== Mask.Brush && subMask.type !== Mask.Flow)) return null;
        const strokeCount = parameters.lines?.length ?? 0;
        if (strokeCount === 0) return null;
        const operationId = `${subMaskId}_${String(strokeCount)}`;
        const expectedGraphRevision = `brush-mask:${selectedImage.path}:${subMaskId}:${String(strokeCount)}:${String(effectiveImageDimensions.width)}x${String(effectiveImageDimensions.height)}`;

        const receipt = buildBrushMaskCommandReceiptFromParameters(
          parameters,
          {
            expectedGraphRevision,
            imagePath: selectedImage.path,
            imageSize: {
              height: effectiveImageDimensions.height,
              width: effectiveImageDimensions.width,
            },
            maskId: subMaskId,
            maskName: subMask.name?.trim() || subMask.type,
            operationId,
            sessionId: 'brush-mask-canvas-capture',
          },
          { dryRun: true },
        );

        setLastBrushCommandCapture({
          commandHash: receipt.commandHash,
          commandId: receipt.commandId,
          commandType: receipt.commandType,
          coordinateSpace: BRUSH_MASK_COMMAND_COORDINATE_SPACE,
          expectedGraphRevision: receipt.expectedGraphRevision,
          imagePath: receipt.imagePath,
          lastPointCount: receipt.lastPointCount,
          lastStrokeMode: receipt.lastStrokeMode,
          maskId: receipt.maskId,
          operationId: receipt.operationId,
          pressurePointCount: receipt.pressurePointCount,
          receiptVersion: receipt.receiptVersion,
          schemaVersion: receipt.schemaVersion,
          strokeCount: receipt.strokeCount,
          validationStatus: receipt.validationStatus,
        });

        return receipt;
      },
      [effectiveImageDimensions.height, effectiveImageDimensions.width, selectedImage.path],
    );
    const withBrushCommandReceipt = useCallback(
      (parameters: MaskParameters, receipt: BrushMaskCommandReceipt | null): MaskParameters => {
        if (receipt === null) return parameters;
        const existingRawEngine =
          typeof parameters['rawEngine'] === 'object' &&
          parameters['rawEngine'] !== null &&
          !Array.isArray(parameters['rawEngine'])
            ? parameters['rawEngine']
            : {};

        return {
          ...parameters,
          rawEngine: {
            ...existingRawEngine,
            brushMaskCommandReceipt: receipt,
          },
        };
      },
      [],
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

      const isEraser = isAltPressed ? baseTool !== ToolType.Eraser : baseTool === ToolType.Eraser;

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
      baseTool,
      isAltPressed,
    ]);
    const isAiSubjectActive =
      (isMasking || isAiEditing) &&
      (activeSubMask?.type === Mask.AiSubject || activeSubMask?.type === Mask.QuickEraser);
    const isParametricActive =
      (isMasking || isAiEditing) && (activeSubMask?.type === Mask.Color || activeSubMask?.type === Mask.Luminance);
    const isInitialDrawing = (isMasking || isAiEditing) && activeSubMaskParameters?.isInitialDraw === true;

    const isToolActive = isBrushActive || isAiSubjectActive || isInitialDrawing || isParametricActive;
    const samplerSuppressed =
      isCropping ||
      isMasking ||
      isAiEditing ||
      isSliderDragging ||
      isStraightenActive ||
      Boolean(isRotationActive) ||
      isWbPickerActive ||
      isMaskInteractionActive ||
      isToolActive ||
      (viewerInputState?.activeTool !== undefined && viewerInputState.activeTool !== 'none');
    const [viewerSampleResult, setViewerSampleResult] = useState<ViewerSampleResult | null>(null);
    const [viewerSampleLocked, setViewerSampleLocked] = useState(false);
    const [viewerSampleTarget, setViewerSampleTarget] = useState<ViewerSampleTarget>(
      isExportSoftProofEnabled ? 'softProof' : 'edited',
    );
    const latestViewerSampleRequestRef = useRef<ViewerSampleRequest | null>(null);
    const executeViewerSampleRef = useRef<(request: ViewerSampleRequest) => Promise<void>>(async () => {});
    const viewerSampleSchedulerRef = useRef<LatestViewerSampleScheduler | null>(null);
    if (!viewerSampleSchedulerRef.current) {
      viewerSampleSchedulerRef.current = new LatestViewerSampleScheduler((request) =>
        executeViewerSampleRef.current(request),
      );
    }
    executeViewerSampleRef.current = async (request) => {
      try {
        const result = await invokeWithSchema(Invokes.SampleViewerPixel, { request }, viewerSampleResultSchema);
        if (isViewerSampleResultCurrent(result, latestViewerSampleRequestRef.current)) {
          setViewerSampleResult(result);
        }
      } catch {
        if (latestViewerSampleRequestRef.current?.requestIdentity === request.requestIdentity) {
          setViewerSampleResult({
            status: 'unavailable',
            requestIdentity: request.requestIdentity,
            reason: 'frameUnavailable',
            spaceLabel: 'Unavailable',
          });
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
      setViewerSampleResult(null);
    }, [
      overlayGeometry.geometryEpoch,
      selectedImage.path,
      viewerSampleGraphRevision,
      compareMode,
      exportSoftProofRecipeId,
      isExportSoftProofEnabled,
      wgpuPreviewVisibility.previewBackend,
    ]);

    const handleViewerSamplerPointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (viewerSampleLocked || samplerSuppressed || event.pointerType === 'touch') return;
        const surface = event.currentTarget;
        const rect = surface.getBoundingClientRect();
        const normalizedViewerX = (event.clientX - rect.x) / rect.width;
        const normalizedViewerY = (event.clientY - rect.y) / rect.height;
        const target = resolveViewerSampleTarget({
          compareMode,
          compareDividerPosition,
          compareOrientation,
          normalizedViewerX,
          normalizedViewerY,
          softProofEnabled: isExportSoftProofEnabled,
        });
        const sideBySideRenderSize =
          compareMode === 'side-by-side' ? (target === 'original' ? originalImageRenderSize : imageRenderSize) : null;
        const mapped = mapViewerPointToImage({
          clientPoint: { x: event.clientX, y: event.clientY },
          displayedImageRect: sideBySideRenderSize
            ? {
                x: sideBySideRenderSize.offsetX,
                y: sideBySideRenderSize.offsetY,
                width: sideBySideRenderSize.width,
                height: sideBySideRenderSize.height,
              }
            : overlayGeometry.displayedImageRectInViewCssPixels,
          surfaceRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            layoutWidth: surface.offsetWidth,
            layoutHeight: surface.offsetHeight,
          },
        });
        if (!mapped) {
          latestViewerSampleRequestRef.current = null;
          viewerSampleSchedulerRef.current?.clear();
          setViewerSampleResult(null);
          return;
        }
        const request = createViewerSampleRequest({
          imageIdentity: selectedImage.path,
          graphRevision: viewerSampleGraphRevision,
          geometryEpoch: overlayGeometry.geometryEpoch,
          normalizedImagePoint: mapped.normalizedImagePoint,
          sourceImageSize: { width: selectedImage.width, height: selectedImage.height },
          target,
          sampleRadiusImagePx: event.altKey ? 4 : 0,
          requestedSpace: 'displayEncoded',
        });
        setViewerSampleTarget(target);
        latestViewerSampleRequestRef.current = request;
        viewerSampleSchedulerRef.current?.schedule(request);
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
      setViewerSampleResult(null);
    }, [viewerSampleLocked]);

    useEffect(() => {
      if (maskOverlayUrl && (isMasking || isAiEditing)) {
        setDisplayedMaskUrl(maskOverlayUrl);
      } else {
        setDisplayedMaskUrl(null);
      }
    }, [maskOverlayUrl, isMasking, isAiEditing]);

    useEffect(() => {
      if (isToolActive) {
        return;
      }
      isDrawing.current = false;
      drawingStageRef.current = null;
      dragStartPointer.current = null;
      currentLine.current = null;
      lastBrushPoint.current = null;
      setLiveBrushLine(null);
      setPreviewBox(null);
      previewBoxRef.current = null;
      setLocalInitialDrawParams(null);
    }, [isToolActive]);

    useEffect(() => {
      if (!isMasking && !isAiEditing) {
        setIsMaskInteractionActive(false);
      }
    }, [isMasking, isAiEditing]);

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

    useEffect(() => {
      if (isCropping && uncroppedAdjustedPreviewUrl) {
        const timer = setTimeout(() => {
          setIsCropViewVisible(true);
        }, 10);
        return () => {
          clearTimeout(timer);
        };
      } else {
        setIsCropViewVisible(false);
      }
      return undefined;
    }, [isCropping, uncroppedAdjustedPreviewUrl]);

    const handleWbClick = useCallback(
      (e: CanvasKonvaEvent) => {
        if (!isWbPickerActive || !finalPreviewUrl || !onWbPicked) return;

        const stage = e.target.getStage();
        const pointerPos = getCanvasPointer(stage);
        if (!pointerPos) return;

        const cropPoint = overlayGeometry.viewToCrop(overlayPoint<'view-css-pixels'>(pointerPos.x, pointerPos.y));
        const x = cropPoint.x;
        const y = cropPoint.y;
        const imgLogicalWidth = overlayGeometry.cropRectInOrientedPixels.width;
        const imgLogicalHeight = overlayGeometry.cropRectInOrientedPixels.height;
        const sampleGeometryEpoch = captureGeometryEpoch(overlayGeometry);

        if (x < 0 || x > imgLogicalWidth || y < 0 || y > imgLogicalHeight) return;

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = finalPreviewUrl;

        img.onload = () => {
          if (!isGeometryEpochCurrent(sampleGeometryEpoch, overlayGeometry)) return;
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

          const averageRgb = averageWhiteBalancePickerRgbaSample(ctx.getImageData(0, 0, sw, sh).data);
          if (!averageRgb) return;

          const command = buildWhiteBalancePickerAdjustmentCommand({
            averageRgb,
            coordinates: {
              imageX: x,
              imageY: y,
              previewPixelX: srcX,
              previewPixelY: srcY,
            },
            currentAdjustments: adjustments,
            previewIdentity: finalPreviewUrl,
            selectedImagePath: selectedImage.path,
          });

          onWbPicked(command.receipt, command.nextAdjustments);
        };
      },
      [
        adjustments,
        finalPreviewUrl,
        isWbPickerActive,
        onWbPicked,
        overlayGeometry,
        selectedImage.path,
        getCanvasPointer,
      ],
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
          updateSubMask(activeId, { parameters: newParams });
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
            currentLine.current = null;
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

          const isAltPressed = e.evt.altKey;
          let effectiveTool;

          if (isAltPressed) {
            effectiveTool = baseTool === ToolType.Brush ? ToolType.Eraser : ToolType.Brush;
          } else {
            effectiveTool = baseTool;
          }
          if (isBrushActive && e.evt.shiftKey && lastBrushPoint.current) {
            const startImageSpace = lastBrushPoint.current;
            const endImageSpace = getImageSpacePoint(pos);

            const dx = endImageSpace.x - startImageSpace.x;
            const dy = endImageSpace.y - startImageSpace.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(Math.ceil(distance), 2);
            const endPressure =
              'pointerType' in e.evt && e.evt.pointerType !== 'mouse' && typeof e.evt.pressure === 'number'
                ? Math.max(0, Math.min(1, e.evt.pressure))
                : undefined;
            const interpolatedPoints: BrushPoint[] = [];
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              interpolatedPoints.push({
                ...(endPressure === undefined ? {} : { pressure: endPressure }),
                x: startImageSpace.x + dx * t,
                y: startImageSpace.y + dy * t,
              });
            }

            const imageSpaceLine: DrawnLine = {
              brushSize: brushImageSpaceSize,
              feather: brushSettings?.feather ? brushSettings.feather / 100 : 0,
              points: interpolatedPoints,
              tool: effectiveTool,
              ...(activeLineFlow !== undefined ? { flow: activeLineFlow } : {}),
            };

            const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
            if (!activeSubMaskParameters) return;
            const existingLines = activeSubMaskParameters.lines || [];
            const nextParameters: MaskParameters = {
              ...activeSubMaskParameters,
              lines: [...existingLines, imageSpaceLine],
            };
            const receipt = recordBrushMaskCommandCapture(activeId, activeSubMask, nextParameters);

            updateSubMask(activeId, {
              parameters: withBrushCommandReceipt(nextParameters, receipt),
            });

            lastBrushPoint.current = endImageSpace;
            isDrawing.current = false;
            currentLine.current = null;
            setLiveBrushLine(null);
            return;
          }

          isDrawing.current = true;
          drawingStageRef.current = stage;
          const brushPoint = withPointerPressure(pos, e.evt);

          const newLine: DrawnLine = {
            brushSize: isBrushActive && brushSettings?.size ? brushStageSize : 2,
            points: [brushPoint],
            tool: effectiveTool,
          };
          currentLine.current = newLine;
          if (isBrushActive) {
            setLiveBrushLine({
              brushSize: brushImageSpaceSize,
              feather: brushSettings?.feather ? brushSettings.feather / 100 : 0,
              points: [getImageSpacePoint(brushPoint)],
              tool: effectiveTool,
              ...(activeLineFlow !== undefined ? { flow: activeLineFlow } : {}),
            });
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
        recordBrushMaskCommandCapture,
        updateSubMask,
        effectiveImageDimensions,
        isToolActive,
        brushImageSpaceSize,
        brushStageSize,
        baseTool,
        getCanvasPointer,
        getImageSpacePoint,
        withPointerPressure,
      ],
    );

    const handleMove = useCallback(
      (e: CanvasMoveEvent) => {
        if (isWbPickerActive) {
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

        if (!isDrawing.current || !isToolActive) {
          return;
        }
        if (!isGeometryEpochCurrent(pointerGeometryEpochRef.current, overlayGeometry)) {
          isDrawing.current = false;
          currentLine.current = null;
          previewBoxRef.current = null;
          setLiveBrushLine(null);
          setPreviewBox(null);
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
            updateSubMask(activeId, { parameters: updatedParams });
          }

          if (isKonvaEvent(e) && e.evt.cancelable) e.evt.preventDefault();
          return;
        }

        if (!pos) {
          return;
        }

        if (currentLine.current) {
          const lastPoint = currentLine.current.points[currentLine.current.points.length - 1];
          if (lastPoint) {
            const dx = pos.x - lastPoint.x;
            const dy = pos.y - lastPoint.y;
            if (dx * dx + dy * dy < 4) {
              if (isKonvaEvent(e) && e.evt.cancelable) e.evt.preventDefault();
              return;
            }
          }

          const brushPoint = withPointerPressure(pos, isKonvaEvent(e) ? e.evt : e);
          const updatedLine = {
            ...currentLine.current,
            points: [...currentLine.current.points, brushPoint],
          };
          currentLine.current = updatedLine;

          if (isBrushActive) {
            const isAltPressedDuringMove = window.altKeyDown || false;
            let effectiveToolForPreview;

            if (isAltPressedDuringMove) {
              effectiveToolForPreview = baseTool === ToolType.Brush ? ToolType.Eraser : ToolType.Brush;
            } else {
              effectiveToolForPreview = baseTool;
            }

            const imageSpaceLine: DrawnLine = {
              brushSize: brushImageSpaceSize,
              feather: brushSettings?.feather ? brushSettings.feather / 100 : 0,
              points: updatedLine.points.map(getImageSpacePoint),
              tool: effectiveToolForPreview,
              ...(activeLineFlow !== undefined ? { flow: activeLineFlow } : {}),
            };

            setLiveBrushLine(imageSpaceLine);

            if (onLiveMaskPreview && activeContainer) {
              const existingLines = activeSubMaskParameters?.lines || [];
              const previewSubMask = {
                ...activeSubMask,
                parameters: {
                  ...activeSubMaskParameters,
                  lines: [...existingLines, imageSpaceLine],
                },
              };

              const previewContainer = {
                ...activeContainer,
                subMasks: activeContainer.subMasks.map((sm: SubMask) =>
                  sm.id === activeSubMask.id ? previewSubMask : sm,
                ),
              };

              onLiveMaskPreview(previewContainer);
            }
          }
          if (isKonvaEvent(e) && e.evt.cancelable) e.evt.preventDefault();
        }
      },
      [
        isToolActive,
        isWbPickerActive,
        isInitialDrawing,
        activeMaskId,
        activeAiSubMaskId,
        updateSubMask,
        onLiveMaskPreview,
        activeContainer,
        activeSubMask,
        activeSubMaskParameters,
        isBrushActive,
        activeLineFlow,
        isAiSubjectActive,
        imageRenderSize,
        adjustments.crop,
        effectiveImageDimensions,
        brushSettings,
        isMasking,
        localInitialDrawParams,
        brushImageSpaceSize,
        baseTool,
        getCanvasPointer,
        getImageSpacePoint,
        withPointerPressure,
      ],
    );

    const handleUp = useCallback(() => {
      if (!isDrawing.current) {
        return;
      }
      if (!isGeometryEpochCurrent(pointerGeometryEpochRef.current, overlayGeometry)) {
        isDrawing.current = false;
        currentLine.current = null;
        previewBoxRef.current = null;
        setLiveBrushLine(null);
        setPreviewBox(null);
        return;
      }

      if (isInitialDrawing && localInitialDrawParams && dragStartPointer.current) {
        if (!activeSubMask) return;
        isDrawing.current = false;
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

        updateSubMask(activeId, { parameters: newParams });
        setLocalInitialDrawParams(null);
        dragStartPointer.current = null;
        return;
      }

      if (!currentLine.current && !(isAiSubjectActive && previewBoxRef.current)) {
        return;
      }

      if (isAiSubjectActive && previewBoxRef.current) {
        isDrawing.current = false;
        const box = previewBoxRef.current;
        previewBoxRef.current = null;
        setPreviewBox(null);
        drawingStageRef.current = null;

        const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

        const startPoint = getImageSpacePoint(box.start);
        let endPoint = getImageSpacePoint(box.end);

        const dx = box.end.x - box.start.x;
        const dy = box.end.y - box.start.y;
        if (Math.sqrt(dx * dx + dy * dy) < 5) {
          endPoint = { x: startPoint.x, y: startPoint.y };
        }

        if (activeId) {
          updateSubMask(activeId, {
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
        return;
      }

      isDrawing.current = false;
      const line = currentLine.current;
      currentLine.current = null;
      drawingStageRef.current = null;
      setLiveBrushLine(null);

      if (!line) {
        return;
      }

      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

      if (isBrushActive) {
        const wasAltPressed = window.altKeyDown || false;
        const effectiveToolForFinal = wasAltPressed
          ? baseTool === ToolType.Brush
            ? ToolType.Eraser
            : ToolType.Brush
          : baseTool;

        const imageSpaceLine: DrawnLine = {
          brushSize: brushImageSpaceSize,
          feather: brushSettings?.feather ? brushSettings.feather / 100 : 0,
          points: line.points.map(getImageSpacePoint),
          tool: effectiveToolForFinal,
          ...(activeLineFlow !== undefined ? { flow: activeLineFlow } : {}),
        };

        if (!activeSubMaskParameters) return;
        const existingLines = activeSubMaskParameters.lines || [];
        const nextParameters: MaskParameters = {
          ...activeSubMaskParameters,
          lines: [...existingLines, imageSpaceLine],
        };
        const receipt = recordBrushMaskCommandCapture(activeId, activeSubMask, nextParameters);

        updateSubMask(activeId, {
          parameters: withBrushCommandReceipt(nextParameters, receipt),
        });

        const lastPoint = line.points[line.points.length - 1];
        if (lastPoint) {
          lastBrushPoint.current = getImageSpacePoint(lastPoint);
        }
      }
    }, [
      isInitialDrawing,
      activeAiSubMaskId,
      activeMaskId,
      activeSubMask,
      activeSubMaskParameters,
      brushSettings,
      isBrushActive,
      activeLineFlow,
      isMasking,
      onGenerateAiMask,
      onQuickErase,
      updateSubMask,
      recordBrushMaskCommandCapture,
      getImageSpacePoint,
      withBrushCommandReceipt,
      effectiveImageDimensions,
      localInitialDrawParams,
      brushImageSpaceSize,
      baseTool,
      imageRenderSize,
      isAiSubjectActive,
    ]);

    const handleMouseEnter = useCallback(() => {
      if (isToolActive) {
        setCursorPreview((p: CursorPreview) => ({ ...p, visible: true }));
      }
    }, [isToolActive]);

    const handleMouseLeave = useCallback(() => {
      setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
    }, []);

    useEffect(() => {
      if (!isToolActive) return;

      function onGlobalMove(e: MouseEvent | TouchEvent) {
        if (!isDrawing.current) return;
        handleMove(e);
      }

      function onGlobalUp() {
        if (!isDrawing.current) return;
        handleUp();
      }

      window.addEventListener('mousemove', onGlobalMove, { passive: false });
      window.addEventListener('mouseup', onGlobalUp);
      window.addEventListener('touchmove', onGlobalMove, { passive: false });
      window.addEventListener('touchcancel', onGlobalUp);
      return () => {
        window.removeEventListener('mousemove', onGlobalMove);
        window.removeEventListener('mouseup', onGlobalUp);
        window.removeEventListener('touchmove', onGlobalMove);
        window.removeEventListener('touchcancel', onGlobalUp);
      };
    }, [isToolActive, handleMove, handleUp]);

    const handleStraightenMouseDown = (e: CanvasKonvaEvent) => {
      if (isNonPrimaryButton(e)) {
        return;
      }

      isStraightening.current = true;
      const pos = e.target.getStage()?.getPointerPosition() ?? null;
      if (!pos) return;
      setStraightenLine({ start: pos, end: pos });
    };

    const handleStraightenMouseMove = (e: CanvasKonvaEvent) => {
      if (!isStraightening.current) {
        return;
      }

      const pos = e.target.getStage()?.getPointerPosition() ?? null;
      if (!pos) return;
      setStraightenLine((prev: StraightenLine | null) => (prev ? { ...prev, end: pos } : prev));
      if (e.evt.cancelable) e.evt.preventDefault();
    };

    const handleStraightenMouseUp = () => {
      if (!isStraightening.current) {
        return;
      }
      isStraightening.current = false;
      if (
        !straightenLine ||
        (straightenLine.start.x === straightenLine.end.x && straightenLine.start.y === straightenLine.end.y)
      ) {
        setStraightenLine(null);
        return;
      }

      const { start, end } = straightenLine;
      const { rotation } = adjustments;
      const theta_rad = (rotation * Math.PI) / 180;
      const cos_t = Math.cos(theta_rad);
      const sin_t = Math.sin(theta_rad);
      const width = uncroppedImageRenderSize?.width ?? 0;
      const height = uncroppedImageRenderSize?.height ?? 0;
      const cx = width / 2;
      const cy = height / 2;

      const unrotate = (p: Coord) => {
        const x = p.x - cx;
        const y = p.y - cy;
        return {
          x: cx + x * cos_t + y * sin_t,
          y: cy - x * sin_t + y * cos_t,
        };
      };

      const start_unrotated = unrotate(start);
      const end_unrotated = unrotate(end);
      const dx = end_unrotated.x - start_unrotated.x;
      const dy = end_unrotated.y - start_unrotated.y;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      let targetAngle;

      if (angle > -45 && angle <= 45) {
        targetAngle = 0;
      } else if (angle > 45 && angle <= 135) {
        targetAngle = 90;
      } else if (angle > 135 || angle <= -135) {
        targetAngle = 180;
      } else {
        targetAngle = -90;
      }

      let correction = targetAngle - angle;
      if (correction > 180) {
        correction -= 360;
      }
      if (correction < -180) {
        correction += 360;
      }

      onStraighten(correction);
      setStraightenLine(null);
    };

    const handleStraightenMouseLeave = () => {
      if (isStraightening.current) {
        isStraightening.current = false;
        setStraightenLine(null);
      }
    };

    const retouchPointToCanvas = useCallback(
      (point: RetouchCloneSource['sourcePoint']): Coord =>
        overlayGeometry.cropToView(
          overlayGeometry.orientedToCrop(
            overlayGeometry.normalizedOrientedToOriented(
              overlayPoint<'normalized-oriented'>(clamp01(point.x), clamp01(point.y)),
            ),
          ),
        ),
      [overlayGeometry],
    );

    const canvasPointToRetouchPoint = useCallback(
      (point: Coord): RetouchCloneSource['sourcePoint'] => {
        const normalized = overlayGeometry.orientedToNormalized(
          overlayGeometry.cropToOriented(overlayGeometry.viewToCrop(overlayPoint<'view-css-pixels'>(point.x, point.y))),
        );
        return { x: clamp01(normalized.x), y: clamp01(normalized.y) };
      },
      [overlayGeometry],
    );

    const dragBoundRetouchHandle = useCallback(
      (point: Vector2d): Vector2d => ({
        x: Math.max(0, Math.min(overlayGeometry.displayedImageRectInViewCssPixels.width, point.x)),
        y: Math.max(0, Math.min(overlayGeometry.displayedImageRectInViewCssPixels.height, point.y)),
      }),
      [overlayGeometry],
    );
    const retouchGeometryEpochRef = useRef<ReturnType<typeof captureGeometryEpoch> | null>(null);
    const captureRetouchGeometryEpoch = useCallback(() => {
      retouchGeometryEpochRef.current = captureGeometryEpoch(overlayGeometry);
    }, [overlayGeometry]);

    const updateRetouchHandlePoint = useCallback(
      (layerId: string, handle: RetouchHandleKind, point: RetouchCloneSource['sourcePoint']) => {
        setAdjustments((prev: Adjustments) => ({
          ...prev,
          masks: prev.masks.map((mask: MaskContainer) => {
            if (mask.id !== layerId || mask.retouchCloneSource === undefined) return mask;
            let syncedTargetMask = false;
            const updatedSubMasks =
              handle === 'targetPoint'
                ? mask.subMasks.map((subMask: SubMask) => {
                    if (subMask.type !== Mask.Radial || syncedTargetMask) return subMask;
                    syncedTargetMask = true;
                    return {
                      ...subMask,
                      parameters: {
                        ...subMask.parameters,
                        centerX: point.x * effectiveImageDimensions.width,
                        centerY: point.y * effectiveImageDimensions.height,
                      },
                    };
                  })
                : mask.subMasks;
            return {
              ...mask,
              retouchCloneSource: {
                ...mask.retouchCloneSource,
                [handle]: point,
              },
              subMasks: updatedSubMasks,
            };
          }),
        }));
      },
      [effectiveImageDimensions.height, effectiveImageDimensions.width, setAdjustments],
    );

    const handleRetouchHandleDragEnd = useCallback(
      (layerId: string, handle: RetouchHandleKind, event: RetouchHandleDragEvent) => {
        event.evt.stopPropagation();
        if (!isGeometryEpochCurrent(retouchGeometryEpochRef.current, overlayGeometry)) return;
        const point = canvasPointToRetouchPoint({ x: event.target.x(), y: event.target.y() });
        updateRetouchHandlePoint(layerId, handle, point);
      },
      [canvasPointToRetouchPoint, overlayGeometry, updateRetouchHandlePoint],
    );
    const handleRetouchHandleDragMove = useCallback(
      (layerId: string, handle: RetouchHandleKind, event: RetouchHandleDragEvent) => {
        event.evt.stopPropagation();
        if (!isGeometryEpochCurrent(retouchGeometryEpochRef.current, overlayGeometry)) return;
        const point = canvasPointToRetouchPoint({ x: event.target.x(), y: event.target.y() });
        updateRetouchHandlePoint(layerId, handle, point);
      },
      [canvasPointToRetouchPoint, overlayGeometry, updateRetouchHandlePoint],
    );
    const handleRetouchCanvasClick = useCallback(
      (layerId: string, event: CanvasKonvaEvent) => {
        if (isNonPrimaryButton(event)) return;
        event.evt.stopPropagation();
        const pointer = event.target.getStage()?.getPointerPosition();
        if (!pointer) return;
        const point = canvasPointToRetouchPoint({
          x: pointer.x / maxSafeScale - groupOffsetX,
          y: pointer.y / maxSafeScale - groupOffsetY,
        });
        updateRetouchHandlePoint(layerId, event.evt.altKey ? 'sourcePoint' : 'targetPoint', point);
      },
      [canvasPointToRetouchPoint, groupOffsetX, groupOffsetY, maxSafeScale, updateRetouchHandlePoint],
    );

    const updateRemoveTargetPoint = useCallback(
      (layerId: string, removeSource: RetouchRemoveSource, point: RetouchCloneSource['sourcePoint']) => {
        setAdjustments((prev: Adjustments) => ({
          ...prev,
          masks: prev.masks.map((mask: MaskContainer) => {
            if (mask.id !== layerId || mask.retouchRemoveSource === undefined) return mask;
            const retouchRemoveSource = { ...mask.retouchRemoveSource };
            delete retouchRemoveSource.resolvedSourcePoint;
            return {
              ...mask,
              retouchRemoveSource: {
                ...retouchRemoveSource,
                status: 'needs_regeneration',
              },
              subMasks: mask.subMasks.map((subMask: SubMask) => {
                if (subMask.id !== removeSource.targetMaskId || subMask.type !== Mask.Radial) return subMask;
                return {
                  ...subMask,
                  parameters: {
                    ...subMask.parameters,
                    centerX: point.x * effectiveImageDimensions.width,
                    centerY: point.y * effectiveImageDimensions.height,
                  },
                };
              }),
            };
          }),
        }));
      },
      [effectiveImageDimensions.height, effectiveImageDimensions.width, setAdjustments],
    );

    const handleRemoveTargetDragEnd = useCallback(
      (layerId: string, removeSource: RetouchRemoveSource, event: RetouchHandleDragEvent) => {
        event.evt.stopPropagation();
        if (!isGeometryEpochCurrent(retouchGeometryEpochRef.current, overlayGeometry)) return;
        const point = canvasPointToRetouchPoint({ x: event.target.x(), y: event.target.y() });
        updateRemoveTargetPoint(layerId, removeSource, point);
      },
      [canvasPointToRetouchPoint, overlayGeometry, updateRemoveTargetPoint],
    );
    const handleRemoveTargetDragMove = useCallback(
      (layerId: string, removeSource: RetouchRemoveSource, event: RetouchHandleDragEvent) => {
        event.evt.stopPropagation();
        if (!isGeometryEpochCurrent(retouchGeometryEpochRef.current, overlayGeometry)) return;
        const point = canvasPointToRetouchPoint({ x: event.target.x(), y: event.target.y() });
        updateRemoveTargetPoint(layerId, removeSource, point);
      },
      [canvasPointToRetouchPoint, overlayGeometry, updateRemoveTargetPoint],
    );
    const handleRemoveCanvasClick = useCallback(
      (layerId: string, removeSource: RetouchRemoveSource, event: CanvasKonvaEvent) => {
        if (isNonPrimaryButton(event)) return;
        event.evt.stopPropagation();
        const pointer = event.target.getStage()?.getPointerPosition();
        if (!pointer) return;
        const point = canvasPointToRetouchPoint({
          x: pointer.x / maxSafeScale - groupOffsetX,
          y: pointer.y / maxSafeScale - groupOffsetY,
        });
        updateRemoveTargetPoint(layerId, removeSource, point);
      },
      [canvasPointToRetouchPoint, groupOffsetX, groupOffsetY, maxSafeScale, updateRemoveTargetPoint],
    );

    const cropPreviewUrl = uncroppedAdjustedPreviewUrl || selectedImage.thumbnailUrl;
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
      isMaskInteractionActive,
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
    const showInteractiveToolOverlayStage =
      (isMasking || isAiEditing || Boolean(isWbPickerActive)) && !isCompareModeActive && !showGamutWarningOverlay;

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

    const patchGeometryIdentity = buildInteractivePreviewGeometryIdentity(adjustments);
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
      : isWbPickerActive
        ? 'white-balance'
        : activeRetouchSource
          ? 'retouch'
          : activeRemoveSource
            ? 'remove'
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
          : isMaskInteractionActive || liveBrushLine || previewBox
            ? 'drag'
            : activeRemoveSource
              ? activeRemoveSource.status === 'ready'
                ? 'ready'
                : activeRemoveSource.status === 'stale' || activeRemoveSource.status === 'fallback_unchanged'
                  ? 'stale'
                  : 'warning'
              : isToolActive || isCropping || showGamutWarningOverlay
                ? 'active'
                : 'ready';
    const canvasPointerOwner = resolveImageCanvasPointerOwner({
      isCropping,
      isMaskInteractionActive,
      isToolActive,
    });

    return (
      <div
        className="canvas-overlay relative"
        data-canvas-overlay-status={activeCanvasOverlayStatus}
        data-canvas-overlay-tool={activeCanvasOverlayTool}
        data-canvas-pointer-owner={canvasPointerOwner}
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
        data-viewer-active-tool={viewerInputState?.activeTool ?? activeCanvasOverlayTool}
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
        onPointerLeave={handleViewerSamplerPointerLeave}
        onPointerMove={handleViewerSamplerPointerMove}
        style={{ width: '100%', height: '100%', cursor: effectiveCursor, pointerEvents: 'auto' }}
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
            showOriginalCompare={showOriginalCompare}
            showSideBySideCompare={isSideBySideCompare}
            showSplitCompare={showSplitCompare}
            svgPreview={
              <SvgPreviewHandoff
                baseScopeKey={selectedImage.path}
                baseSource={previewSource}
                incomingPatch={coherentInteractivePatch}
                isCpuPreviewVisible={!isWgpuActive}
                isMaxZoom={isMaxZoom}
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
                <div
                  className="absolute bottom-3 right-3 rounded-md border px-3 py-2 text-xs font-medium"
                  style={{
                    background: 'rgba(12, 14, 17, 0.84)',
                    borderColor: 'var(--editor-danger)',
                    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.58)',
                    color: '#ffe8fb',
                  }}
                >
                  {t('editor.canvas.gamutWarningCoverage', {
                    profile: renderedPreviewWarningStatus.displayProfileLabel,
                    value: renderedPreviewWarningStatus.coverageLabel,
                  })}
                </div>
              </div>
            )}
          </PreviewSurface>

          <ViewerSamplerHud
            locked={viewerSampleLocked}
            onToggleLock={() => {
              setViewerSampleLocked((locked) => !locked);
            }}
            result={viewerSampleResult}
            suppressed={samplerSuppressed}
            target={viewerSampleTarget}
          />

          {activeRetouchLayer &&
            activeRetouchSource &&
            showRetouchRemoveHandles &&
            imageRenderSize.width > 0 &&
            imageRenderSize.height > 0 &&
            (() => {
              const sourcePoint = retouchPointToCanvas(activeRetouchSource.sourcePoint);
              const targetPoint = retouchPointToCanvas(activeRetouchSource.targetPoint);
              const handleRadius = Math.max(6, Math.min(10, 7 / Math.max(0.75, transformState.scale)));
              const strokeWidth = Math.max(1.5, 2 / Math.max(0.75, transformState.scale));
              const retouchRadius = overlayGeometry.viewRadiusFromCrop(activeRetouchSource.radiusPx ?? 0);
              const retouchFeatherRadius = overlayGeometry.viewRadiusFromCrop(
                Math.max(0, (activeRetouchSource.radiusPx ?? 0) + (activeRetouchSource.featherRadiusPx ?? 0)),
              );
              const retouchScale = Math.max(0.1, activeRetouchSource.scale);
              const sourceFootprintRadius = retouchRadius / retouchScale;
              const sourceFootprintAxisLength = Math.max(handleRadius * 1.5, sourceFootprintRadius);
              const sourceFootprintRadians = (-activeRetouchSource.rotationDegrees * Math.PI) / 180;
              const sourceFootprintAxisEnd = {
                x: sourcePoint.x + sourceFootprintAxisLength * Math.cos(sourceFootprintRadians),
                y: sourcePoint.y + sourceFootprintAxisLength * Math.sin(sourceFootprintRadians),
              };
              const retouchMode = activeRetouchSource.retouchMode ?? 'clone';
              const activePlacementHandle: RetouchHandleKind = isAltPressed ? 'sourcePoint' : 'targetPoint';
              const sourceHandleRadius =
                activePlacementHandle === 'sourcePoint' ? handleRadius + Math.max(1, strokeWidth) : handleRadius;
              const targetHandleRadius =
                activePlacementHandle === 'targetPoint' ? handleRadius + Math.max(1, strokeWidth) : handleRadius;
              const sourceHandleStrokeWidth = activePlacementHandle === 'sourcePoint' ? strokeWidth + 1 : strokeWidth;
              const targetHandleStrokeWidth = activePlacementHandle === 'targetPoint' ? strokeWidth + 1 : strokeWidth;
              const retouchModeLabel = t(
                retouchMode === 'heal'
                  ? 'editor.layers.retouchSource.modes.heal'
                  : 'editor.layers.retouchSource.modes.clone',
              );

              return (
                <div
                  aria-label={t('editor.layers.retouchSource.title')}
                  className="absolute"
                  data-retouch-handle-layer-id={activeRetouchLayer.id}
                  data-retouch-handle-mode={retouchMode}
                  data-retouch-handle-mode-label={retouchModeLabel}
                  data-retouch-handle-radius-px={activeRetouchSource.radiusPx ?? ''}
                  data-retouch-handle-feather-radius-px={activeRetouchSource.featherRadiusPx ?? ''}
                  data-retouch-handle-rotation-degrees={activeRetouchSource.rotationDegrees}
                  data-retouch-handle-scale={activeRetouchSource.scale}
                  data-retouch-handle-source-x={activeRetouchSource.sourcePoint.x}
                  data-retouch-handle-source-y={activeRetouchSource.sourcePoint.y}
                  data-retouch-handle-target-x={activeRetouchSource.targetPoint.x}
                  data-retouch-handle-target-y={activeRetouchSource.targetPoint.y}
                  data-retouch-canvas-active-handle={activePlacementHandle}
                  data-retouch-canvas-alt-pressed={String(isAltPressed)}
                  data-testid="image-canvas-retouch-handles"
                  style={{
                    height: stageHeight * maxSafeScale,
                    left: stageLeft,
                    opacity: showRetouchRemoveHandles ? 1 : 0,
                    pointerEvents: showRetouchRemoveHandles ? 'auto' : 'none',
                    top: stageTop,
                    touchAction: 'none',
                    transform: `scale(${svgNumber(1 / maxSafeScale)})`,
                    transformOrigin: '0 0',
                    transition: 'opacity 150ms ease-in-out',
                    userSelect: 'none',
                    width: stageWidth * maxSafeScale,
                    zIndex: imageCanvasLayerZIndex('toolGeometry'),
                  }}
                >
                  <Stage height={stageHeight * maxSafeScale} width={stageWidth * maxSafeScale}>
                    <Layer>
                      <Group scaleX={maxSafeScale} scaleY={maxSafeScale}>
                        <Group x={groupOffsetX} y={groupOffsetY}>
                          <Rect
                            cursor="crosshair"
                            data-retouch-canvas-click-target="source-or-target"
                            data-retouch-canvas-click-source-modifier="Alt"
                            data-retouch-canvas-click-active-handle={activePlacementHandle}
                            data-testid="image-canvas-retouch-click-target"
                            fill="rgba(0, 0, 0, 0)"
                            height={overlayGeometry.displayedImageRectInViewCssPixels.height}
                            onClick={(event) => {
                              handleRetouchCanvasClick(activeRetouchLayer.id, event);
                            }}
                            onTap={(event) => {
                              handleRetouchCanvasClick(activeRetouchLayer.id, event);
                            }}
                            width={overlayGeometry.displayedImageRectInViewCssPixels.width}
                            x={0}
                            y={0}
                          />
                          <Line
                            dash={[4, 4]}
                            listening={false}
                            points={[sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y]}
                            stroke={canvasOverlayTokens.colors.neutral}
                            strokeScaleEnabled={false}
                            strokeWidth={strokeWidth}
                            {...canvasOverlayShadowProps}
                          />
                          {retouchFeatherRadius > retouchRadius && (
                            <Circle
                              dash={[5, 5]}
                              listening={false}
                              radius={retouchFeatherRadius}
                              stroke={canvasOverlayTokens.colors.neutral}
                              strokeOpacity={0.55}
                              strokeScaleEnabled={false}
                              strokeWidth={strokeWidth}
                              {...canvasOverlayShadowProps}
                              x={targetPoint.x}
                              y={targetPoint.y}
                            />
                          )}
                          {retouchRadius > 0 && (
                            <Circle
                              listening={false}
                              radius={retouchRadius}
                              stroke={canvasOverlayTokens.colors.target}
                              strokeOpacity={0.8}
                              strokeScaleEnabled={false}
                              strokeWidth={strokeWidth}
                              {...canvasOverlayShadowProps}
                              x={targetPoint.x}
                              y={targetPoint.y}
                            />
                          )}
                          {retouchRadius > 0 && (
                            <>
                              <Circle
                                dash={[3, 3]}
                                data-retouch-source-footprint-radius={sourceFootprintRadius}
                                data-testid="image-canvas-retouch-source-footprint"
                                listening={false}
                                radius={sourceFootprintRadius}
                                stroke={canvasOverlayTokens.colors.active}
                                strokeOpacity={0.65}
                                strokeScaleEnabled={false}
                                strokeWidth={strokeWidth}
                                {...canvasOverlayShadowProps}
                                x={sourcePoint.x}
                                y={sourcePoint.y}
                              />
                              <Line
                                data-retouch-source-footprint-rotation-degrees={activeRetouchSource.rotationDegrees}
                                data-retouch-source-footprint-scale={activeRetouchSource.scale}
                                data-testid="image-canvas-retouch-source-footprint-axis"
                                listening={false}
                                points={[
                                  sourcePoint.x,
                                  sourcePoint.y,
                                  sourceFootprintAxisEnd.x,
                                  sourceFootprintAxisEnd.y,
                                ]}
                                stroke={canvasOverlayTokens.colors.active}
                                strokeOpacity={0.85}
                                strokeScaleEnabled={false}
                                strokeWidth={strokeWidth}
                                {...canvasOverlayShadowProps}
                              />
                            </>
                          )}
                          <Circle
                            dragBoundFunc={dragBoundRetouchHandle}
                            draggable
                            fill={canvasOverlayTokens.colors.active}
                            onDragStart={captureRetouchGeometryEpoch}
                            onDragEnd={(event) => {
                              handleRetouchHandleDragEnd(activeRetouchLayer.id, 'sourcePoint', event);
                            }}
                            onDragMove={(event) => {
                              handleRetouchHandleDragMove(activeRetouchLayer.id, 'sourcePoint', event);
                            }}
                            onMouseDown={(event) => {
                              event.evt.stopPropagation();
                            }}
                            onTouchStart={(event) => {
                              event.evt.stopPropagation();
                            }}
                            shadowOpacity={activePlacementHandle === 'sourcePoint' ? 0.7 : 0.45}
                            shadowBlur={canvasOverlayTokens.shadow.blur}
                            shadowColor={canvasOverlayTokens.shadow.color}
                            stroke={canvasOverlayTokens.colors.neutral}
                            strokeScaleEnabled={false}
                            strokeWidth={sourceHandleStrokeWidth}
                            x={sourcePoint.x}
                            y={sourcePoint.y}
                            radius={sourceHandleRadius}
                          />
                          <Label
                            data-retouch-canvas-handle="sourcePoint"
                            data-retouch-canvas-mode={retouchMode}
                            data-testid="image-canvas-retouch-source-label"
                            listening={false}
                            x={sourcePoint.x + handleRadius + 8}
                            y={sourcePoint.y - handleRadius - 28}
                          >
                            <Tag
                              cornerRadius={6}
                              fill={canvasOverlayTokens.label.fill}
                              lineJoin="round"
                              stroke={canvasOverlayTokens.colors.active}
                              strokeWidth={1}
                            />
                            <KonvaText
                              {...canvasOverlayLabelTextProps}
                              text={`${retouchModeLabel} ${t('editor.layers.retouchSource.sourceLabel')}`}
                            />
                          </Label>
                          <Circle
                            dragBoundFunc={dragBoundRetouchHandle}
                            draggable
                            fill={canvasOverlayTokens.colors.target}
                            onDragStart={captureRetouchGeometryEpoch}
                            onDragEnd={(event) => {
                              handleRetouchHandleDragEnd(activeRetouchLayer.id, 'targetPoint', event);
                            }}
                            onDragMove={(event) => {
                              handleRetouchHandleDragMove(activeRetouchLayer.id, 'targetPoint', event);
                            }}
                            onMouseDown={(event) => {
                              event.evt.stopPropagation();
                            }}
                            onTouchStart={(event) => {
                              event.evt.stopPropagation();
                            }}
                            shadowOpacity={activePlacementHandle === 'targetPoint' ? 0.7 : 0.45}
                            shadowBlur={canvasOverlayTokens.shadow.blur}
                            shadowColor={canvasOverlayTokens.shadow.color}
                            stroke={canvasOverlayTokens.colors.neutral}
                            strokeScaleEnabled={false}
                            strokeWidth={targetHandleStrokeWidth}
                            x={targetPoint.x}
                            y={targetPoint.y}
                            radius={targetHandleRadius}
                          />
                          <Label
                            data-retouch-canvas-handle="targetPoint"
                            data-retouch-canvas-mode={retouchMode}
                            data-testid="image-canvas-retouch-target-label"
                            listening={false}
                            x={targetPoint.x + handleRadius + 8}
                            y={targetPoint.y - handleRadius - 28}
                          >
                            <Tag
                              cornerRadius={6}
                              fill={canvasOverlayTokens.label.fill}
                              lineJoin="round"
                              stroke={canvasOverlayTokens.colors.target}
                              strokeWidth={1}
                            />
                            <KonvaText
                              {...canvasOverlayLabelTextProps}
                              text={`${retouchModeLabel} ${t('editor.layers.retouchSource.targetLabel')}`}
                            />
                          </Label>
                        </Group>
                      </Group>
                    </Layer>
                  </Stage>
                </div>
              );
            })()}

          {activeRemoveLayer &&
            activeRemoveSource &&
            activeRemoveTargetSubMask &&
            showRetouchRemoveHandles &&
            imageRenderSize.width > 0 &&
            imageRenderSize.height > 0 &&
            (() => {
              const targetX = numberParameter(
                activeRemoveTargetSubMask.parameters,
                'centerX',
                effectiveImageDimensions.width * 0.5,
              );
              const targetY = numberParameter(
                activeRemoveTargetSubMask.parameters,
                'centerY',
                effectiveImageDimensions.height * 0.5,
              );
              const targetPoint = overlayGeometry.cropToView(
                overlayGeometry.orientedToCrop(overlayPoint<'oriented-pixels'>(targetX, targetY)),
              );
              const resolvedSourcePoint =
                activeRemoveSource.resolvedSourcePoint === undefined
                  ? null
                  : retouchPointToCanvas(activeRemoveSource.resolvedSourcePoint);
              const handleRadius = Math.max(6, Math.min(10, 7 / Math.max(0.75, transformState.scale)));
              const strokeWidth = Math.max(1.5, 2 / Math.max(0.75, transformState.scale));
              const removeRadius = overlayGeometry.viewRadiusFromCrop(activeRemoveSource.radiusPx ?? 48);
              const removeSearchRadius = overlayGeometry.viewRadiusFromCrop(
                (activeRemoveSource.radiusPx ?? 48) * activeRemoveSource.searchRadiusMultiplier,
              );
              const removeFeatherRadius = overlayGeometry.viewRadiusFromCrop(
                Math.max(0, (activeRemoveSource.radiusPx ?? 48) + (activeRemoveSource.featherRadiusPx ?? 24)),
              );
              const removeStatus = activeRemoveSource.status ?? 'needs_regeneration';
              const removeStatusLabel = t(`editor.layers.removeSource.status.${removeStatus}`);
              const removeStatusColor = getRemoveCanvasStatusColor(activeRemoveSource.status);
              const isOriginalPreserved = removeStatus === 'fallback_unchanged' && resolvedSourcePoint === null;
              const removeTargetStrokeOpacity = isOriginalPreserved ? 0.55 : 0.8;
              const removeTargetDash = isOriginalPreserved ? [7, 5] : [];

              return (
                <div
                  aria-label={t('editor.layers.removeSource.title')}
                  className="absolute"
                  data-remove-handle-layer-id={activeRemoveLayer.id}
                  data-remove-handle-radius-px={activeRemoveSource.radiusPx ?? ''}
                  data-remove-handle-feather-radius-px={activeRemoveSource.featherRadiusPx ?? ''}
                  data-remove-handle-search-radius-multiplier={activeRemoveSource.searchRadiusMultiplier}
                  data-remove-handle-search-radius-px={removeSearchRadius}
                  data-remove-handle-status-color={removeStatusColor}
                  data-remove-handle-status={activeRemoveSource.status ?? 'needs_regeneration'}
                  data-remove-handle-status-label={removeStatusLabel}
                  data-remove-handle-original-preserved={String(isOriginalPreserved)}
                  data-remove-handle-target-x={targetX}
                  data-remove-handle-target-y={targetY}
                  data-remove-handle-resolved-source-x={activeRemoveSource.resolvedSourcePoint?.x ?? ''}
                  data-remove-handle-resolved-source-y={activeRemoveSource.resolvedSourcePoint?.y ?? ''}
                  data-remove-handle-source-resolved={String(activeRemoveSource.resolvedSourcePoint !== undefined)}
                  data-testid="image-canvas-remove-handles"
                  style={{
                    height: stageHeight * maxSafeScale,
                    left: stageLeft,
                    opacity: showRetouchRemoveHandles ? 1 : 0,
                    pointerEvents: showRetouchRemoveHandles ? 'auto' : 'none',
                    top: stageTop,
                    touchAction: 'none',
                    transform: `scale(${svgNumber(1 / maxSafeScale)})`,
                    transformOrigin: '0 0',
                    transition: 'opacity 150ms ease-in-out',
                    userSelect: 'none',
                    width: stageWidth * maxSafeScale,
                    zIndex: imageCanvasLayerZIndex('toolGeometry'),
                  }}
                >
                  <Stage height={stageHeight * maxSafeScale} width={stageWidth * maxSafeScale}>
                    <Layer>
                      <Group scaleX={maxSafeScale} scaleY={maxSafeScale}>
                        <Group x={groupOffsetX} y={groupOffsetY}>
                          <Rect
                            data-remove-canvas-click-target="target"
                            data-testid="image-canvas-remove-click-target"
                            fill="rgba(0, 0, 0, 0)"
                            height={overlayGeometry.displayedImageRectInViewCssPixels.height}
                            onClick={(event) => {
                              handleRemoveCanvasClick(activeRemoveLayer.id, activeRemoveSource, event);
                            }}
                            onTap={(event) => {
                              handleRemoveCanvasClick(activeRemoveLayer.id, activeRemoveSource, event);
                            }}
                            width={overlayGeometry.displayedImageRectInViewCssPixels.width}
                            x={0}
                            y={0}
                          />
                          {resolvedSourcePoint && (
                            <Line
                              dash={[4, 4]}
                              listening={false}
                              points={[resolvedSourcePoint.x, resolvedSourcePoint.y, targetPoint.x, targetPoint.y]}
                              stroke={canvasOverlayTokens.colors.neutral}
                              strokeScaleEnabled={false}
                              strokeWidth={strokeWidth}
                              {...canvasOverlayShadowProps}
                            />
                          )}
                          {removeSearchRadius > removeRadius && (
                            <Circle
                              dash={[10, 7]}
                              data-remove-canvas-search-radius-multiplier={activeRemoveSource.searchRadiusMultiplier}
                              data-remove-canvas-search-radius-px={removeSearchRadius}
                              data-testid="image-canvas-remove-search-radius"
                              listening={false}
                              radius={removeSearchRadius}
                              stroke={canvasOverlayTokens.colors.remove}
                              strokeOpacity={0.45}
                              strokeScaleEnabled={false}
                              strokeWidth={strokeWidth}
                              {...canvasOverlayShadowProps}
                              x={targetPoint.x}
                              y={targetPoint.y}
                            />
                          )}
                          {removeFeatherRadius > removeRadius && (
                            <Circle
                              dash={[5, 5]}
                              listening={false}
                              radius={removeFeatherRadius}
                              stroke={canvasOverlayTokens.colors.neutral}
                              strokeOpacity={0.55}
                              strokeScaleEnabled={false}
                              strokeWidth={strokeWidth}
                              {...canvasOverlayShadowProps}
                              x={targetPoint.x}
                              y={targetPoint.y}
                            />
                          )}
                          <Circle
                            listening={false}
                            radius={removeRadius}
                            stroke={removeStatusColor}
                            dash={removeTargetDash}
                            strokeOpacity={removeTargetStrokeOpacity}
                            strokeScaleEnabled={false}
                            strokeWidth={strokeWidth}
                            {...canvasOverlayShadowProps}
                            x={targetPoint.x}
                            y={targetPoint.y}
                          />
                          {resolvedSourcePoint && (
                            <Circle
                              fill={canvasOverlayTokens.colors.active}
                              listening={false}
                              radius={handleRadius}
                              {...canvasOverlayShadowProps}
                              stroke={canvasOverlayTokens.colors.neutral}
                              strokeScaleEnabled={false}
                              strokeWidth={strokeWidth}
                              x={resolvedSourcePoint.x}
                              y={resolvedSourcePoint.y}
                            />
                          )}
                          {resolvedSourcePoint && (
                            <Label
                              data-remove-canvas-handle="resolvedSource"
                              data-remove-canvas-source-label={removeStatusLabel}
                              data-testid="image-canvas-remove-source-label"
                              listening={false}
                              x={resolvedSourcePoint.x + handleRadius + 8}
                              y={resolvedSourcePoint.y - handleRadius - 28}
                            >
                              <Tag
                                cornerRadius={6}
                                fill={canvasOverlayTokens.label.fill}
                                lineJoin="round"
                                stroke={canvasOverlayTokens.colors.active}
                                strokeWidth={1}
                              />
                              <KonvaText
                                {...canvasOverlayLabelTextProps}
                                text={t('editor.layers.removeSource.sourceResolved')}
                              />
                            </Label>
                          )}
                          <Circle
                            dragBoundFunc={dragBoundRetouchHandle}
                            draggable
                            fill={removeStatusColor}
                            onDragEnd={(event) => {
                              handleRemoveTargetDragEnd(activeRemoveLayer.id, activeRemoveSource, event);
                            }}
                            onDragMove={(event) => {
                              handleRemoveTargetDragMove(activeRemoveLayer.id, activeRemoveSource, event);
                            }}
                            onMouseDown={(event) => {
                              event.evt.stopPropagation();
                            }}
                            onTouchStart={(event) => {
                              event.evt.stopPropagation();
                            }}
                            radius={handleRadius}
                            {...canvasOverlayShadowProps}
                            stroke={canvasOverlayTokens.colors.neutral}
                            strokeScaleEnabled={false}
                            strokeWidth={strokeWidth}
                            x={targetPoint.x}
                            y={targetPoint.y}
                          />
                          <Label
                            data-remove-canvas-original-preserved={String(isOriginalPreserved)}
                            data-remove-canvas-search-radius-multiplier={activeRemoveSource.searchRadiusMultiplier}
                            data-remove-canvas-seed={activeRemoveSource.seed}
                            data-remove-canvas-status={removeStatus}
                            data-remove-canvas-source-resolved={String(resolvedSourcePoint !== null)}
                            data-testid="image-canvas-remove-status-label"
                            listening={false}
                            x={targetPoint.x + handleRadius + 8}
                            y={targetPoint.y - handleRadius - 28}
                          >
                            <Tag
                              cornerRadius={6}
                              fill={canvasOverlayTokens.label.fill}
                              lineJoin="round"
                              stroke={removeStatusColor}
                              strokeWidth={1}
                            />
                            <KonvaText
                              {...canvasOverlayLabelTextProps}
                              text={t('editor.layers.removeSource.canvasStatus', {
                                searchMultiplier: activeRemoveSource.searchRadiusMultiplier,
                                seedValue: activeRemoveSource.seed,
                                status: removeStatusLabel,
                              })}
                            />
                          </Label>
                        </Group>
                      </Group>
                    </Layer>
                  </Stage>
                </div>
              );
            })()}

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
          isCropping={isCropping}
          isCropViewVisible={isCropViewVisible}
          isMaxZoom={isMaxZoom}
          isRotationActive={isRotationActive}
          isStraightenActive={isStraightenActive}
          overlayMode={overlayMode}
          overlayRotation={overlayRotation}
          setCrop={setCrop}
          straightenOverlay={
            isStraightenActive && (
              <Stage
                height={uncroppedImageRenderSize?.height ?? 0}
                onMouseDown={handleStraightenMouseDown}
                onMouseLeave={handleStraightenMouseLeave}
                onMouseMove={handleStraightenMouseMove}
                onMouseUp={handleStraightenMouseUp}
                onTouchEnd={handleStraightenMouseUp}
                onTouchMove={handleStraightenMouseMove}
                onTouchStart={handleStraightenMouseDown}
                style={{
                  cursor: 'crosshair',
                  left: 0,
                  position: 'absolute',
                  top: 0,
                  touchAction: 'none',
                  zIndex: imageCanvasLayerZIndex('activeTool'),
                }}
                width={uncroppedImageRenderSize?.width ?? 0}
              >
                <Layer>
                  {straightenLine && (
                    <Line
                      dash={[4, 4]}
                      listening={false}
                      points={[
                        straightenLine.start.x,
                        straightenLine.start.y,
                        straightenLine.end.x,
                        straightenLine.end.y,
                      ]}
                      stroke={canvasOverlayTokens.colors.active}
                      {...canvasOverlayShadowProps}
                      strokeWidth={2}
                    />
                  )}
                </Layer>
              </Stage>
            )
          }
        />
      </div>
    );
  },
);

ImageCanvas.displayName = 'ImageCanvas';

export default ImageCanvas;
