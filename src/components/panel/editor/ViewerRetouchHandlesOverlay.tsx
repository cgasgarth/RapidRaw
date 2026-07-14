import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, Group, Text as KonvaText, Label, Layer, Line, Rect, Stage, Tag } from 'react-konva';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import { imageCanvasLayerZIndex } from './imageCanvasContracts';
import { canvasOverlayStatusColor, canvasOverlayTokens } from './overlays/canvasOverlayTokens';
import type { ViewerRetouchHandlesControllerBinding } from './useViewerRetouchHandlesController';
import { resolveViewerRetouchFootprint, viewerRetouchNormalizedToView } from './viewerRetouchGeometry';
import type { ViewerRetouchHandle, ViewerRetouchPoint, ViewerRetouchPointer } from './viewerRetouchHandlesController';

interface ViewerRetouchHandlesOverlayProps {
  readonly binding: ViewerRetouchHandlesControllerBinding;
  readonly geometry: EditorOverlayGeometry;
  readonly groupOffsetX: number;
  readonly groupOffsetY: number;
  readonly maxSafeScale: number;
  readonly stageHeight: number;
  readonly stageLeft: number;
  readonly stageTop: number;
  readonly stageWidth: number;
  readonly zoomScale: number;
}

type RetouchKonvaEvent = KonvaEventObject<MouseEvent | PointerEvent | TouchEvent | DragEvent>;
const pointerFrom = (event: RetouchKonvaEvent): ViewerRetouchPointer => {
  const native = event.evt;
  const touch = 'touches' in native ? (native.touches[0] ?? native.changedTouches[0]) : undefined;
  const type = 'pointerType' in native ? native.pointerType : touch === undefined ? 'mouse' : 'touch';
  return {
    id: 'pointerId' in native ? native.pointerId : touch ? touch.identifier + 1 : 1,
    pressure: 'pressure' in native ? Math.max(0, Math.min(1, native.pressure)) : 0,
    type: type === 'pen' || type === 'touch' ? type : 'mouse',
  };
};
const statusColor = (status: 'fallback_unchanged' | 'needs_regeneration' | 'ready' | 'stale'): string =>
  status === 'ready'
    ? canvasOverlayStatusColor('ready')
    : status === 'fallback_unchanged' || status === 'stale'
      ? canvasOverlayStatusColor('stale')
      : canvasOverlayStatusColor('warning');
const shadow = {
  shadowBlur: canvasOverlayTokens.shadow.blur,
  shadowColor: canvasOverlayTokens.shadow.color,
  shadowOpacity: canvasOverlayTokens.shadow.opacity,
} as const;
const labelText = {
  fill: canvasOverlayTokens.label.text,
  fontFamily: canvasOverlayTokens.label.fontFamily,
  fontSize: canvasOverlayTokens.label.fontSize,
  fontStyle: canvasOverlayTokens.label.fontStyle,
  padding: canvasOverlayTokens.label.padding,
} as const;

interface RetouchPlacementSurfaceProps {
  readonly height: number;
  readonly testId: string;
  readonly width: number;
}

const RetouchPlacementSurface = ({ height, testId, width }: RetouchPlacementSurfaceProps) => (
  <Rect
    cursor="crosshair"
    data-testid={testId}
    fill="rgba(0, 0, 0, 0)"
    height={height}
    listening={false}
    width={width}
  />
);

export const ViewerRetouchHandlesOverlay = ({
  binding,
  geometry,
  groupOffsetX,
  groupOffsetY,
  maxSafeScale,
  stageHeight,
  stageLeft,
  stageTop,
  stageWidth,
  zoomScale,
}: ViewerRetouchHandlesOverlayProps) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const descriptor = binding.descriptor;
  const toView = (point: { readonly x: number; readonly y: number }) => viewerRetouchNormalizedToView(geometry, point);
  const handleRadius = Math.max(6, Math.min(10, 7 / Math.max(0.75, zoomScale)));
  const strokeWidth = Math.max(1.5, 2 / Math.max(0.75, zoomScale));
  const routingRef = useRef({ binding, descriptor, geometry, groupOffsetX, groupOffsetY, handleRadius, strokeWidth });
  routingRef.current = { binding, descriptor, geometry, groupOffsetX, groupOffsetY, handleRadius, strokeWidth };
  const frameStyle = {
    height: stageHeight * maxSafeScale,
    left: stageLeft,
    pointerEvents: 'auto' as const,
    top: stageTop,
    touchAction: 'none',
    transform: `scale(${String(1 / maxSafeScale)})`,
    transformOrigin: '0 0',
    userSelect: 'none' as const,
    width: stageWidth * maxSafeScale,
    zIndex: imageCanvasLayerZIndex('toolGeometry'),
  };
  const stop = (event: RetouchKonvaEvent) => {
    event.cancelBubble = true;
    event.evt.stopPropagation();
  };
  const viewPointFromKonva = (event: RetouchKonvaEvent): ViewerRetouchPoint => {
    const pointer = event.target.getStage()?.getPointerPosition();
    return pointer === undefined || pointer === null
      ? { x: event.target.x(), y: event.target.y() }
      : {
          x: pointer.x / maxSafeScale - groupOffsetX,
          y: pointer.y / maxSafeScale - groupOffsetY,
        };
  };
  const startDrag = (handle: ViewerRetouchHandle, event: RetouchKonvaEvent) => {
    stop(event);
    binding.begin(handle, pointerFrom(event), viewPointFromKonva(event));
  };
  const moveDrag = (event: RetouchKonvaEvent) => {
    stop(event);
    binding.move(pointerFrom(event), viewPointFromKonva(event));
  };
  const endDrag = (event: RetouchKonvaEvent) => {
    stop(event);
    binding.end(pointerFrom(event), viewPointFromKonva(event));
  };
  const suppressHandlePlacement = (event: RetouchKonvaEvent) => {
    stop(event);
  };
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (hit === null || !container.contains(hit)) return;
      const routing = routingRef.current;
      const bounds = container.getBoundingClientRect();
      const viewPoint = {
        x: event.clientX - bounds.x - routing.groupOffsetX,
        y: event.clientY - bounds.y - routing.groupOffsetY,
      };
      const imageRect = routing.geometry.displayedImageRectInViewCssPixels;
      if (viewPoint.x < 0 || viewPoint.y < 0 || viewPoint.x > imageRect.width || viewPoint.y > imageRect.height) return;
      const handlePoints =
        routing.descriptor?.kind === 'clone'
          ? [
              viewerRetouchNormalizedToView(routing.geometry, routing.descriptor.sourcePoint),
              viewerRetouchNormalizedToView(routing.geometry, routing.descriptor.targetPoint),
            ]
          : routing.descriptor?.kind === 'remove'
            ? [viewerRetouchNormalizedToView(routing.geometry, routing.descriptor.targetPoint)]
            : [];
      const handleHitRadius = routing.handleRadius + Math.max(4, routing.strokeWidth);
      if (handlePoints.some((point) => Math.hypot(point.x - viewPoint.x, point.y - viewPoint.y) <= handleHitRadius)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      routing.binding.place(
        event.altKey,
        {
          id: event.pointerId,
          pressure: Math.max(0, Math.min(1, event.pressure)),
          type: event.pointerType === 'pen' || event.pointerType === 'touch' ? event.pointerType : 'mouse',
        },
        viewPoint,
      );
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [descriptor?.kind]);
  if (descriptor === null || stageWidth <= 0 || stageHeight <= 0) return null;

  if (descriptor.kind === 'clone') {
    const sourcePoint = toView(descriptor.sourcePoint);
    const targetPoint = toView(descriptor.targetPoint);
    const {
      axisEnd,
      featherRadius,
      radius,
      sourceFootprintRadius: footprintRadius,
    } = resolveViewerRetouchFootprint({
      featherRadiusPx: descriptor.featherRadiusPx,
      handleRadius,
      radiusPx: descriptor.radiusPx,
      rotationDegrees: descriptor.rotationDegrees,
      scale: descriptor.scale,
      sourcePoint,
      viewRadiusFromCrop: geometry.viewRadiusFromCrop,
    });
    const modeLabel = t(
      descriptor.mode === 'heal' ? 'editor.layers.retouchSource.modes.heal' : 'editor.layers.retouchSource.modes.clone',
    );
    return (
      <div
        aria-label={t('editor.layers.retouchSource.title')}
        className="absolute"
        data-retouch-canvas-active-handle={descriptor.activeHandle}
        data-retouch-canvas-alt-pressed={String(descriptor.activeHandle === 'sourcePoint')}
        data-retouch-canvas-click-active-handle={descriptor.activeHandle}
        data-retouch-canvas-click-source-modifier="Alt"
        data-retouch-canvas-click-target="source-or-target"
        data-retouch-handle-feather-radius-px={descriptor.featherRadiusPx}
        data-retouch-handle-layer-id={descriptor.layerId}
        data-retouch-handle-mode={descriptor.mode}
        data-retouch-handle-mode-label={modeLabel}
        data-retouch-handle-radius-px={descriptor.radiusPx}
        data-retouch-handle-rotation-degrees={descriptor.rotationDegrees}
        data-retouch-handle-scale={descriptor.scale}
        data-retouch-handle-source-x={descriptor.sourcePoint.x}
        data-retouch-handle-source-y={descriptor.sourcePoint.y}
        data-retouch-handle-target-x={descriptor.targetPoint.x}
        data-retouch-handle-target-y={descriptor.targetPoint.y}
        data-testid="image-canvas-retouch-handles"
        ref={containerRef}
        style={frameStyle}
      >
        <Stage height={stageHeight * maxSafeScale} width={stageWidth * maxSafeScale}>
          <Layer>
            <Group scaleX={maxSafeScale} scaleY={maxSafeScale}>
              <Group x={groupOffsetX} y={groupOffsetY}>
                <RetouchPlacementSurface
                  height={geometry.displayedImageRectInViewCssPixels.height}
                  testId="image-canvas-retouch-click-target"
                  width={geometry.displayedImageRectInViewCssPixels.width}
                />
                <Line
                  {...shadow}
                  dash={[4, 4]}
                  listening={false}
                  points={[sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y]}
                  stroke={canvasOverlayTokens.colors.neutral}
                  strokeScaleEnabled={false}
                  strokeWidth={strokeWidth}
                />
                {featherRadius > radius && (
                  <Circle
                    {...shadow}
                    dash={[5, 5]}
                    listening={false}
                    radius={featherRadius}
                    stroke={canvasOverlayTokens.colors.neutral}
                    strokeOpacity={0.55}
                    strokeScaleEnabled={false}
                    strokeWidth={strokeWidth}
                    x={targetPoint.x}
                    y={targetPoint.y}
                  />
                )}
                {radius > 0 && (
                  <>
                    <Circle
                      {...shadow}
                      listening={false}
                      radius={radius}
                      stroke={canvasOverlayTokens.colors.target}
                      strokeOpacity={0.8}
                      strokeScaleEnabled={false}
                      strokeWidth={strokeWidth}
                      x={targetPoint.x}
                      y={targetPoint.y}
                    />
                    <Circle
                      {...shadow}
                      dash={[3, 3]}
                      data-retouch-source-footprint-radius={footprintRadius}
                      data-testid="image-canvas-retouch-source-footprint"
                      listening={false}
                      radius={footprintRadius}
                      stroke={canvasOverlayTokens.colors.active}
                      strokeOpacity={0.65}
                      strokeScaleEnabled={false}
                      strokeWidth={strokeWidth}
                      x={sourcePoint.x}
                      y={sourcePoint.y}
                    />
                    <Line
                      {...shadow}
                      data-retouch-source-footprint-rotation-degrees={descriptor.rotationDegrees}
                      data-retouch-source-footprint-scale={descriptor.scale}
                      data-testid="image-canvas-retouch-source-footprint-axis"
                      listening={false}
                      points={[sourcePoint.x, sourcePoint.y, axisEnd.x, axisEnd.y]}
                      stroke={canvasOverlayTokens.colors.active}
                      strokeOpacity={0.85}
                      strokeScaleEnabled={false}
                      strokeWidth={strokeWidth}
                    />
                  </>
                )}
                {(['sourcePoint', 'targetPoint'] as const).map((handle) => {
                  const point = handle === 'sourcePoint' ? sourcePoint : targetPoint;
                  const color =
                    handle === 'sourcePoint' ? canvasOverlayTokens.colors.active : canvasOverlayTokens.colors.target;
                  const selected = descriptor.activeHandle === handle;
                  return (
                    <Group key={handle}>
                      <Circle
                        draggable
                        fill={color}
                        onDragEnd={endDrag}
                        onDragMove={moveDrag}
                        onDragStart={(event) => startDrag(handle, event)}
                        onClick={stop}
                        onMouseDown={suppressHandlePlacement}
                        onPointerDown={suppressHandlePlacement}
                        onTap={stop}
                        onTouchStart={suppressHandlePlacement}
                        radius={handleRadius + (selected ? Math.max(1, strokeWidth) : 0)}
                        shadowBlur={canvasOverlayTokens.shadow.blur}
                        shadowColor={canvasOverlayTokens.shadow.color}
                        shadowOpacity={selected ? 0.7 : 0.45}
                        stroke={canvasOverlayTokens.colors.neutral}
                        strokeScaleEnabled={false}
                        strokeWidth={selected ? strokeWidth + 1 : strokeWidth}
                        x={point.x}
                        y={point.y}
                      />
                      <Label
                        data-retouch-canvas-handle={handle}
                        data-retouch-canvas-mode={descriptor.mode}
                        data-testid={`image-canvas-retouch-${handle === 'sourcePoint' ? 'source' : 'target'}-label`}
                        listening={false}
                        x={point.x + handleRadius + 8}
                        y={point.y - handleRadius - 28}
                      >
                        <Tag
                          cornerRadius={6}
                          fill={canvasOverlayTokens.label.fill}
                          lineJoin="round"
                          stroke={color}
                          strokeWidth={1}
                        />
                        <KonvaText
                          {...labelText}
                          text={`${modeLabel} ${t(
                            handle === 'sourcePoint'
                              ? 'editor.layers.retouchSource.sourceLabel'
                              : 'editor.layers.retouchSource.targetLabel',
                          )}`}
                        />
                      </Label>
                    </Group>
                  );
                })}
              </Group>
            </Group>
          </Layer>
        </Stage>
      </div>
    );
  }

  const targetPoint = toView(descriptor.targetPoint);
  const resolvedSourcePoint = descriptor.resolvedSourcePoint === null ? null : toView(descriptor.resolvedSourcePoint);
  const radius = geometry.viewRadiusFromCrop(descriptor.radiusPx);
  const featherRadius = geometry.viewRadiusFromCrop(descriptor.radiusPx + descriptor.featherRadiusPx);
  const searchRadius = geometry.viewRadiusFromCrop(descriptor.radiusPx * descriptor.searchRadiusMultiplier);
  const color = statusColor(descriptor.status);
  const statusLabel = t(`editor.layers.removeSource.status.${descriptor.status}`);
  return (
    <div
      aria-label={t('editor.layers.removeSource.title')}
      className="absolute"
      data-remove-canvas-click-target="target"
      data-remove-handle-feather-radius-px={descriptor.featherRadiusPx}
      data-remove-handle-layer-id={descriptor.layerId}
      data-remove-handle-original-preserved={String(descriptor.isOriginalPreserved)}
      data-remove-handle-radius-px={descriptor.radiusPx}
      data-remove-handle-resolved-source-x={descriptor.resolvedSourcePoint?.x ?? ''}
      data-remove-handle-resolved-source-y={descriptor.resolvedSourcePoint?.y ?? ''}
      data-remove-handle-search-radius-multiplier={descriptor.searchRadiusMultiplier}
      data-remove-handle-search-radius-px={searchRadius}
      data-remove-handle-source-resolved={String(descriptor.resolvedSourcePoint !== null)}
      data-remove-handle-status={descriptor.status}
      data-remove-handle-status-color={color}
      data-remove-handle-status-label={statusLabel}
      data-remove-handle-target-x={descriptor.targetPoint.x * geometry.orientedSize.width}
      data-remove-handle-target-y={descriptor.targetPoint.y * geometry.orientedSize.height}
      data-testid="image-canvas-remove-handles"
      ref={containerRef}
      style={frameStyle}
    >
      <Stage height={stageHeight * maxSafeScale} width={stageWidth * maxSafeScale}>
        <Layer>
          <Group scaleX={maxSafeScale} scaleY={maxSafeScale}>
            <Group x={groupOffsetX} y={groupOffsetY}>
              <RetouchPlacementSurface
                height={geometry.displayedImageRectInViewCssPixels.height}
                testId="image-canvas-remove-click-target"
                width={geometry.displayedImageRectInViewCssPixels.width}
              />
              {resolvedSourcePoint && (
                <>
                  <Line
                    {...shadow}
                    dash={[4, 4]}
                    listening={false}
                    points={[resolvedSourcePoint.x, resolvedSourcePoint.y, targetPoint.x, targetPoint.y]}
                    stroke={canvasOverlayTokens.colors.neutral}
                    strokeScaleEnabled={false}
                    strokeWidth={strokeWidth}
                  />
                  <Circle
                    {...shadow}
                    fill={canvasOverlayTokens.colors.active}
                    listening={false}
                    radius={handleRadius}
                    stroke={canvasOverlayTokens.colors.neutral}
                    strokeScaleEnabled={false}
                    strokeWidth={strokeWidth}
                    x={resolvedSourcePoint.x}
                    y={resolvedSourcePoint.y}
                  />
                  <Label
                    data-remove-canvas-handle="resolvedSource"
                    data-remove-canvas-source-label={statusLabel}
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
                    <KonvaText {...labelText} text={t('editor.layers.removeSource.sourceResolved')} />
                  </Label>
                </>
              )}
              {searchRadius > radius && (
                <Circle
                  {...shadow}
                  dash={[10, 7]}
                  data-remove-canvas-search-radius-multiplier={descriptor.searchRadiusMultiplier}
                  data-remove-canvas-search-radius-px={searchRadius}
                  data-testid="image-canvas-remove-search-radius"
                  listening={false}
                  radius={searchRadius}
                  stroke={canvasOverlayTokens.colors.remove}
                  strokeOpacity={0.45}
                  strokeScaleEnabled={false}
                  strokeWidth={strokeWidth}
                  x={targetPoint.x}
                  y={targetPoint.y}
                />
              )}
              {featherRadius > radius && (
                <Circle
                  {...shadow}
                  dash={[5, 5]}
                  listening={false}
                  radius={featherRadius}
                  stroke={canvasOverlayTokens.colors.neutral}
                  strokeOpacity={0.55}
                  strokeScaleEnabled={false}
                  strokeWidth={strokeWidth}
                  x={targetPoint.x}
                  y={targetPoint.y}
                />
              )}
              <Circle
                {...shadow}
                dash={descriptor.isOriginalPreserved ? [7, 5] : []}
                listening={false}
                radius={radius}
                stroke={color}
                strokeOpacity={descriptor.isOriginalPreserved ? 0.55 : 0.8}
                strokeScaleEnabled={false}
                strokeWidth={strokeWidth}
                x={targetPoint.x}
                y={targetPoint.y}
              />
              <Circle
                {...shadow}
                draggable
                fill={color}
                onDragEnd={endDrag}
                onDragMove={moveDrag}
                onDragStart={(event) => startDrag('targetPoint', event)}
                onClick={stop}
                onMouseDown={suppressHandlePlacement}
                onPointerDown={suppressHandlePlacement}
                onTap={stop}
                onTouchStart={suppressHandlePlacement}
                radius={handleRadius}
                stroke={canvasOverlayTokens.colors.neutral}
                strokeScaleEnabled={false}
                strokeWidth={strokeWidth}
                x={targetPoint.x}
                y={targetPoint.y}
              />
              <Label
                data-remove-canvas-original-preserved={String(descriptor.isOriginalPreserved)}
                data-remove-canvas-search-radius-multiplier={descriptor.searchRadiusMultiplier}
                data-remove-canvas-seed={descriptor.seed}
                data-remove-canvas-source-resolved={String(resolvedSourcePoint !== null)}
                data-remove-canvas-status={descriptor.status}
                data-testid="image-canvas-remove-status-label"
                listening={false}
                x={targetPoint.x + handleRadius + 8}
                y={targetPoint.y - handleRadius - 28}
              >
                <Tag
                  cornerRadius={6}
                  fill={canvasOverlayTokens.label.fill}
                  lineJoin="round"
                  stroke={color}
                  strokeWidth={1}
                />
                <KonvaText
                  {...labelText}
                  text={t('editor.layers.removeSource.canvasStatus', {
                    searchMultiplier: descriptor.searchRadiusMultiplier,
                    seedValue: descriptor.seed,
                    status: statusLabel,
                  })}
                />
              </Label>
            </Group>
          </Group>
        </Layer>
      </Stage>
    </div>
  );
};
