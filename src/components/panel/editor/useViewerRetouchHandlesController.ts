import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { MaskContainer, RetouchRemoveSource } from '../../../utils/adjustments';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import { createRetouchLayerRevision } from '../../../utils/retouchHandleEditTransaction';
import type { SubMask } from '../right/layers/Masks';
import type { ViewerSurfaceInputEvent, ViewerSurfacePointerEvent } from './viewerInputRouter';
import {
  viewerRetouchNormalizedToView,
  viewerRetouchSurfacePointToView,
  viewerRetouchViewToNormalized,
} from './viewerRetouchGeometry';
import {
  createViewerRetouchHandlesController,
  type ViewerRetouchCommand,
  type ViewerRetouchCurrentContext,
  type ViewerRetouchHandle,
  type ViewerRetouchPoint,
  type ViewerRetouchPointer,
} from './viewerRetouchHandlesController';

export type ViewerRetouchOverlayDescriptor =
  | {
      readonly activeHandle: ViewerRetouchHandle;
      readonly featherRadiusPx: number;
      readonly geometryEpoch: number;
      readonly kind: 'clone';
      readonly layerId: string;
      readonly mode: 'clone' | 'heal';
      readonly radiusPx: number;
      readonly rotationDegrees: number;
      readonly scale: number;
      readonly sourcePoint: ViewerRetouchPoint;
      readonly targetPoint: ViewerRetouchPoint;
      readonly pointerPolicy: 'capture';
      readonly zOrder: 'tool-geometry';
    }
  | {
      readonly featherRadiusPx: number;
      readonly geometryEpoch: number;
      readonly isOriginalPreserved: boolean;
      readonly kind: 'remove';
      readonly layerId: string;
      readonly radiusPx: number;
      readonly resolvedSourcePoint: ViewerRetouchPoint | null;
      readonly searchRadiusMultiplier: number;
      readonly seed: number;
      readonly status: NonNullable<RetouchRemoveSource['status']>;
      readonly targetPoint: ViewerRetouchPoint;
      readonly pointerPolicy: 'capture';
      readonly zOrder: 'tool-geometry';
    };

interface UseViewerRetouchHandlesControllerInput {
  readonly activeCloneLayer: MaskContainer | null;
  readonly activeRemoveLayer: MaskContainer | null;
  readonly activeRemoveTargetSubMask: SubMask | null;
  readonly altPressed: boolean;
  readonly geometry: EditorOverlayGeometry;
  readonly imageSessionId: string;
  readonly onCommit: (command: ViewerRetouchCommand) => void;
  readonly presentation: EditorPresentationDescriptor;
  readonly visible: boolean;
}

export interface ViewerRetouchHandlesControllerBinding {
  readonly activeMode: 'remove' | 'retouch' | null;
  readonly descriptor: ViewerRetouchOverlayDescriptor | null;
  readonly interactionActive: boolean;
  readonly lastCommitStatus: string;
  cancel(): void;
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
}

const numberParameter = (parameters: SubMask['parameters'], key: string, fallback: number): number => {
  const value = parameters?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
export const useViewerRetouchHandlesController = ({
  activeCloneLayer,
  activeRemoveLayer,
  activeRemoveTargetSubMask,
  altPressed,
  geometry,
  imageSessionId,
  onCommit,
  presentation,
  visible,
}: UseViewerRetouchHandlesControllerInput): ViewerRetouchHandlesControllerBinding => {
  const controller = useMemo(() => createViewerRetouchHandlesController(), []);
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const lastCommitStatusRef = useRef('none');
  const cloneSource = activeCloneLayer?.retouchCloneSource ?? null;
  const removeSource = activeRemoveLayer?.retouchRemoveSource ?? null;
  const mode = cloneSource?.retouchMode ?? (removeSource === null ? 'clone' : 'remove');
  const layerId = activeCloneLayer?.id ?? activeRemoveLayer?.id ?? 'retouch:none';
  const activeLayer = activeCloneLayer ?? activeRemoveLayer;
  const layerRevision =
    activeLayer === null ? 'retouch:none' : createRetouchLayerRevision(activeLayer, geometry.orientedSize);
  const current = useMemo<ViewerRetouchCurrentContext>(
    () => ({
      active: visible && (cloneSource !== null || (removeSource !== null && activeRemoveTargetSubMask !== null)),
      geometryEpoch: geometry.geometryEpoch,
      imageSessionId,
      layerId,
      layerRevision,
      mode,
      sourceIdentity: presentation.sourceIdentity,
      sourceRevision: presentation.graphRevision,
      toolId: 'retouch-handles',
    }),
    [
      activeRemoveTargetSubMask,
      cloneSource,
      geometry.geometryEpoch,
      imageSessionId,
      layerId,
      layerRevision,
      mode,
      presentation.sourceIdentity,
      presentation.graphRevision,
      removeSource,
      visible,
    ],
  );
  const currentRef = useRef(current);
  currentRef.current = current;
  useLayoutEffect(() => {
    controller.synchronize(current);
    refresh();
  }, [controller, current]);

  const normalizedPoint = useCallback(
    (point: ViewerRetouchPoint): ViewerRetouchPoint => viewerRetouchViewToNormalized(geometry, point),
    [geometry],
  );
  const execute = useCallback(
    (command: ViewerRetouchCommand | null) => {
      if (command === null) return;
      try {
        onCommit(command);
        controller.receive(command.key, currentRef.current);
        lastCommitStatusRef.current = `committed:${String(command.key.operationGeneration)}`;
      } catch (error) {
        controller.fail(command.key, currentRef.current);
        lastCommitStatusRef.current = `rejected:${error instanceof Error ? error.message : 'unknown'}`;
      }
      refresh();
    },
    [controller, onCommit],
  );
  const cancel = useCallback(() => {
    controller.cancel();
    refresh();
  }, [controller]);

  useEffect(() => () => controller.cancel(), [controller]);

  const override = controller.overlayOverride();
  let descriptor: ViewerRetouchOverlayDescriptor | null = null;
  if (cloneSource !== null && activeCloneLayer !== null && current.active) {
    descriptor = {
      activeHandle: altPressed ? 'sourcePoint' : 'targetPoint',
      featherRadiusPx: cloneSource.featherRadiusPx ?? 0,
      geometryEpoch: current.geometryEpoch,
      kind: 'clone',
      layerId: activeCloneLayer.id,
      mode: cloneSource.retouchMode ?? 'clone',
      radiusPx: cloneSource.radiusPx ?? 0,
      rotationDegrees: cloneSource.rotationDegrees,
      scale: cloneSource.scale,
      sourcePoint: override?.handle === 'sourcePoint' ? override.point : cloneSource.sourcePoint,
      targetPoint: override?.handle === 'targetPoint' ? override.point : cloneSource.targetPoint,
      pointerPolicy: 'capture',
      zOrder: 'tool-geometry',
    };
  } else if (
    removeSource !== null &&
    activeRemoveLayer !== null &&
    activeRemoveTargetSubMask !== null &&
    current.active
  ) {
    const orientedWidth = Math.max(1, geometry.orientedSize.width);
    const orientedHeight = Math.max(1, geometry.orientedSize.height);
    const targetPoint = {
      x:
        numberParameter(activeRemoveTargetSubMask.parameters, 'centerX', geometry.orientedSize.width * 0.5) /
        orientedWidth,
      y:
        numberParameter(activeRemoveTargetSubMask.parameters, 'centerY', geometry.orientedSize.height * 0.5) /
        orientedHeight,
    };
    descriptor = {
      featherRadiusPx: removeSource.featherRadiusPx ?? 24,
      geometryEpoch: current.geometryEpoch,
      isOriginalPreserved:
        removeSource.status === 'fallback_unchanged' && removeSource.resolvedSourcePoint === undefined,
      kind: 'remove',
      layerId: activeRemoveLayer.id,
      radiusPx: removeSource.radiusPx ?? 48,
      resolvedSourcePoint: removeSource.resolvedSourcePoint ?? null,
      searchRadiusMultiplier: removeSource.searchRadiusMultiplier,
      seed: removeSource.seed,
      status: removeSource.status ?? 'needs_regeneration',
      targetPoint: override?.point ?? targetPoint,
      pointerPolicy: 'capture',
      zOrder: 'tool-geometry',
    };
  }

  const pointerFromEvent = (event: ViewerSurfacePointerEvent): ViewerRetouchPointer => ({
    id: event.pointerId,
    pressure: event.pressure,
    type: event.pointerType,
  });
  const viewPointFromEvent = (event: ViewerSurfacePointerEvent): ViewerRetouchPoint | null => {
    if (event.surfaceRect === undefined) return null;
    return viewerRetouchSurfacePointToView(geometry, event, event.surfaceRect);
  };
  const isInsideImage = (point: ViewerRetouchPoint): boolean => {
    const rect = geometry.displayedImageRectInViewCssPixels;
    return point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height;
  };
  const hitHandle = (point: ViewerRetouchPoint): ViewerRetouchHandle | null => {
    if (descriptor?.kind === 'clone') {
      const source = viewerRetouchNormalizedToView(geometry, descriptor.sourcePoint);
      const target = viewerRetouchNormalizedToView(geometry, descriptor.targetPoint);
      if (Math.hypot(point.x - source.x, point.y - source.y) <= 16) return 'sourcePoint';
      if (Math.hypot(point.x - target.x, point.y - target.y) <= 16) return 'targetPoint';
    } else if (descriptor?.kind === 'remove') {
      const target = viewerRetouchNormalizedToView(geometry, descriptor.targetPoint);
      if (Math.hypot(point.x - target.x, point.y - target.y) <= 16) return 'targetPoint';
    }
    return null;
  };
  const handleInputEvent = (event: ViewerSurfaceInputEvent): void => {
    if (!('pointerId' in event)) {
      cancel();
      return;
    }
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      cancel();
      return;
    }
    const point = viewPointFromEvent(event);
    if (point === null) return;
    const pointer = pointerFromEvent(event);
    if (event.type === 'pointerdown') {
      if (!isInsideImage(point)) return;
      const handle = hitHandle(point);
      if (handle === null) execute(controller.place(currentRef.current, event.altKey, pointer, normalizedPoint(point)));
      else if (controller.begin(currentRef.current, handle, pointer, normalizedPoint(point))) refresh();
      return;
    }
    if (event.type === 'pointermove') {
      if (controller.move(pointer, normalizedPoint(point))) refresh();
      return;
    }
    execute(controller.end(currentRef.current, pointer, normalizedPoint(point)));
  };

  return {
    activeMode: descriptor?.kind === 'remove' ? 'remove' : descriptor?.kind === 'clone' ? 'retouch' : null,
    cancel,
    descriptor,
    handleInputEvent,
    interactionActive: override !== null,
    lastCommitStatus: lastCommitStatusRef.current,
  };
};
