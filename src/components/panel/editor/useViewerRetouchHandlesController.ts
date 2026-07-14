import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { MaskContainer, RetouchRemoveSource } from '../../../utils/adjustments';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import type { SubMask } from '../right/layers/Masks';
import type { ViewerAdjustmentCommandServices } from './viewerAdjustmentCommandService';
import { createViewerRetouchCommandAdapter } from './viewerRetouchCommandAdapter';
import { viewerRetouchViewToNormalized } from './viewerRetouchGeometry';
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
      readonly kind: 'clone';
      readonly layerId: string;
      readonly mode: 'clone' | 'heal';
      readonly radiusPx: number;
      readonly rotationDegrees: number;
      readonly scale: number;
      readonly sourcePoint: ViewerRetouchPoint;
      readonly targetPoint: ViewerRetouchPoint;
    }
  | {
      readonly featherRadiusPx: number;
      readonly isOriginalPreserved: boolean;
      readonly kind: 'remove';
      readonly layerId: string;
      readonly radiusPx: number;
      readonly resolvedSourcePoint: ViewerRetouchPoint | null;
      readonly searchRadiusMultiplier: number;
      readonly seed: number;
      readonly status: NonNullable<RetouchRemoveSource['status']>;
      readonly targetPoint: ViewerRetouchPoint;
    };

interface UseViewerRetouchHandlesControllerInput {
  readonly activeCloneLayer: MaskContainer | null;
  readonly activeRemoveLayer: MaskContainer | null;
  readonly activeRemoveTargetSubMask: SubMask | null;
  readonly adjustments: ViewerAdjustmentCommandServices;
  readonly altPressed: boolean;
  readonly geometry: EditorOverlayGeometry;
  readonly imageSessionId: string;
  readonly presentation: EditorPresentationDescriptor;
  readonly visible: boolean;
}

export interface ViewerRetouchHandlesControllerBinding {
  readonly activeMode: 'remove' | 'retouch' | null;
  readonly descriptor: ViewerRetouchOverlayDescriptor | null;
  begin(handle: ViewerRetouchHandle, pointer: ViewerRetouchPointer, viewPoint: ViewerRetouchPoint): boolean;
  cancel(): void;
  end(pointer: ViewerRetouchPointer, viewPoint: ViewerRetouchPoint): void;
  move(pointer: ViewerRetouchPointer, viewPoint: ViewerRetouchPoint): boolean;
  place(sourceModifier: boolean, pointer: ViewerRetouchPointer, viewPoint: ViewerRetouchPoint): void;
}

const numberParameter = (parameters: SubMask['parameters'], key: string, fallback: number): number => {
  const value = parameters?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
export const useViewerRetouchHandlesController = ({
  activeCloneLayer,
  activeRemoveLayer,
  activeRemoveTargetSubMask,
  adjustments,
  altPressed,
  geometry,
  imageSessionId,
  presentation,
  visible,
}: UseViewerRetouchHandlesControllerInput): ViewerRetouchHandlesControllerBinding => {
  const controller = useMemo(() => createViewerRetouchHandlesController(), []);
  const adapter = useMemo(() => createViewerRetouchCommandAdapter(adjustments), [adjustments]);
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const cloneSource = activeCloneLayer?.retouchCloneSource ?? null;
  const removeSource = activeRemoveLayer?.retouchRemoveSource ?? null;
  const mode = cloneSource?.retouchMode ?? (removeSource === null ? 'clone' : 'remove');
  const layerId = activeCloneLayer?.id ?? activeRemoveLayer?.id ?? 'retouch:none';
  const layerRevision = JSON.stringify(
    cloneSource ?? {
      removeSource,
      targetCenter:
        activeRemoveTargetSubMask === null
          ? null
          : {
              x: numberParameter(activeRemoveTargetSubMask.parameters, 'centerX', geometry.orientedSize.width * 0.5),
              y: numberParameter(activeRemoveTargetSubMask.parameters, 'centerY', geometry.orientedSize.height * 0.5),
            },
    },
  );
  const current = useMemo<ViewerRetouchCurrentContext>(
    () => ({
      active: visible && (cloneSource !== null || (removeSource !== null && activeRemoveTargetSubMask !== null)),
      geometryEpoch: geometry.geometryEpoch,
      imageSessionId,
      layerId,
      layerRevision,
      mode,
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
      const receipt = adapter.commit(command, {
        current: currentRef.current,
        imageSize: { height: geometry.orientedSize.height, width: geometry.orientedSize.width },
        removeSource,
      });
      if (receipt === null) {
        controller.fail(command.key, currentRef.current);
      } else {
        controller.receive(command.key, currentRef.current);
      }
      refresh();
    },
    [adapter, controller, geometry.orientedSize.height, geometry.orientedSize.width, removeSource],
  );
  const cancel = useCallback(() => {
    controller.cancel();
    refresh();
  }, [controller]);

  useEffect(() => {
    const onBlur = () => cancel();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    const onPointerCancel = () => cancel();
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('lostpointercapture', onPointerCancel);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('lostpointercapture', onPointerCancel);
      window.removeEventListener('pointercancel', onPointerCancel);
      controller.cancel();
    };
  }, [cancel, controller]);

  const override = controller.overlayOverride();
  let descriptor: ViewerRetouchOverlayDescriptor | null = null;
  if (cloneSource !== null && activeCloneLayer !== null && current.active) {
    descriptor = {
      activeHandle: altPressed ? 'sourcePoint' : 'targetPoint',
      featherRadiusPx: cloneSource.featherRadiusPx ?? 0,
      kind: 'clone',
      layerId: activeCloneLayer.id,
      mode: cloneSource.retouchMode ?? 'clone',
      radiusPx: cloneSource.radiusPx ?? 0,
      rotationDegrees: cloneSource.rotationDegrees,
      scale: cloneSource.scale,
      sourcePoint: override?.handle === 'sourcePoint' ? override.point : cloneSource.sourcePoint,
      targetPoint: override?.handle === 'targetPoint' ? override.point : cloneSource.targetPoint,
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
    };
  }

  return {
    activeMode: descriptor?.kind === 'remove' ? 'remove' : descriptor?.kind === 'clone' ? 'retouch' : null,
    begin: (handle, pointer, viewPoint) => {
      const accepted = controller.begin(currentRef.current, handle, pointer, normalizedPoint(viewPoint));
      if (accepted) refresh();
      return accepted;
    },
    cancel,
    descriptor,
    end: (pointer, viewPoint) => {
      execute(controller.end(currentRef.current, pointer, normalizedPoint(viewPoint)));
    },
    move: (pointer, viewPoint) => {
      const accepted = controller.move(pointer, normalizedPoint(viewPoint));
      if (accepted) refresh();
      return accepted;
    },
    place: (sourceModifier, pointer, viewPoint) => {
      execute(controller.place(currentRef.current, sourceModifier, pointer, normalizedPoint(viewPoint)));
    },
  };
};
