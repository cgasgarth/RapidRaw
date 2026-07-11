import type { KonvaEventObject, Node as KonvaNode } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import type { Ellipse as KonvaEllipse } from 'konva/lib/shapes/Ellipse';
import type { Transformer as KonvaTransformer } from 'konva/lib/shapes/Transformer';
import type { Vector2d } from 'konva/lib/types';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Ellipse, Group, Line, Rect, Transformer } from 'react-konva';
import type { Coord } from '../../../utils/adjustments';
import {
  captureGeometryEpoch,
  type EditorOverlayGeometry,
  isGeometryEpochCurrent,
  overlayPoint,
} from '../../../utils/editorOverlayGeometry';
import {
  normalizeLinearGradientParameters,
  normalizeRadialGradientParameters,
} from '../../../utils/mask/gradientMaskParameters';
import { Mask, type SubMask, SubMaskMode } from '../right/layers/Masks';
import { canvasOverlayTokens } from './overlays/canvasOverlayTokens';

interface DrawnLine {
  brushSize: number;
  points: Array<Coord>;
  tool: string;
}

export interface MaskParameters {
  [key: string]: boolean | number | Array<DrawnLine> | Record<string, unknown> | undefined;
  centerX: number;
  centerY: number;
  endX: number;
  endY: number;
  feather?: number;
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
  evt?: { type?: string };
}
type CanvasKonvaEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>;
type EditableKonvaEllipse = KonvaEllipse & { lastValidScaleX?: number; lastValidScaleY?: number };
interface RotateStart {
  angle: number;
  rotation: number;
}

const toMaskParameters = (parameters: SubMask['parameters']): MaskParameters => parameters as MaskParameters;
const isNonPrimaryButton = (event: CanvasKonvaEvent): boolean =>
  'button' in event.evt && typeof event.evt.button === 'number' && event.evt.button !== 0;
const setStageCursor = (stage: KonvaStage | null, cursor: string): void => {
  if (stage) stage.container().style.cursor = cursor;
};
const cssPx = (value: number | undefined): string => `${String(value ?? 0)}px`;
const svgNumber = (value: number): string => String(value);
const canvasOverlayShadowProps = {
  shadowBlur: canvasOverlayTokens.shadow.blur,
  shadowColor: canvasOverlayTokens.shadow.color,
  shadowOpacity: canvasOverlayTokens.shadow.opacity,
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
    feather: typeof parameters.feather === 'number' ? parameters.feather : 0.5,
    radiusX: Math.abs(parameters.radiusX),
    radiusY: Math.abs(parameters.radiusY),
    rotation: normalizeLiveGradientRotation(parameters.rotation),
  }),
});

export const translateRadialMask = (parameters: MaskParameters, dx: number, dy: number): MaskParameters =>
  normalizeRadialMaskParametersForLiveHandle({
    ...parameters,
    centerX: parameters.centerX + dx,
    centerY: parameters.centerY + dy,
  });

export const translateLinearMask = (parameters: MaskParameters, dx: number, dy: number): MaskParameters =>
  normalizeLinearMaskParametersForLiveHandle({
    ...parameters,
    endX: parameters.endX + dx,
    endY: parameters.endY + dy,
    startX: parameters.startX + dx,
    startY: parameters.startY + dy,
  });
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

export const getEdgeFadeStyle = (fadeDistancePx: number = 128): React.CSSProperties => ({
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

export const OptimizedBrushLine = memo(({ geometry, line }: { geometry: EditorOverlayGeometry; line: DrawnLine }) => {
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

export const MaskOverlay = memo(
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

        const newP = translateRadialMask(dragStartParams.current, dx, dy);

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

        const newP = translateLinearMask(dragStartParams.current, dx, dy);

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
