import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { useUIStore } from '../../../store/useUIStore';
import { type EditorOverlayGeometry, overlayPoint } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import { createFocusRetouchCommandService } from './focusRetouchCommandService';
import {
  createViewerFocusRetouchInteractionController,
  type ViewerFocusRetouchCommand,
  type ViewerFocusRetouchCurrentContext,
  type ViewerFocusRetouchOverlayDescriptor,
} from './viewerFocusRetouchInteractionController';
import type { ViewerSurfaceInputEvent, ViewerSurfacePointerEvent } from './viewerInputRouter';

interface UseViewerFocusRetouchControllerInput {
  readonly geometry: EditorOverlayGeometry;
  readonly imageSessionId: string;
  readonly presentation: EditorPresentationDescriptor;
}

export interface ViewerFocusRetouchController {
  readonly active: boolean;
  readonly overlays: readonly ViewerFocusRetouchOverlayDescriptor[];
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
}

const fixedPoint = (event: ViewerSurfacePointerEvent, geometry: EditorOverlayGeometry) => {
  if (event.surfaceRect === undefined) return null;
  const oriented = geometry.cropToOriented(
    geometry.viewToCrop(
      overlayPoint<'view-css-pixels'>(event.clientX - event.surfaceRect.x, event.clientY - event.surfaceRect.y),
    ),
  );
  return { x: Math.round(oriented.x * 256), y: Math.round(oriented.y * 256) };
};

export const useViewerFocusRetouchController = ({
  geometry,
  imageSessionId,
  presentation,
}: UseViewerFocusRetouchControllerInput): ViewerFocusRetouchController => {
  const state = useUIStore((value) => value.focusRetouchToolState);
  const setUI = useUIStore((value) => value.setUI);
  const controller = useMemo(() => createViewerFocusRetouchInteractionController(), []);
  const commands = useMemo(() => createFocusRetouchCommandService(), []);
  const [, refreshOverlay] = useReducer((revision: number) => revision + 1, 0);
  const current: ViewerFocusRetouchCurrentContext = useMemo(
    () => ({
      active: state.active,
      geometryEpoch: geometry.geometryEpoch,
      imageSessionId,
      packagePath: state.packagePath,
      revisionId: state.session?.revision?.revisionId ?? null,
      sourceRevision: presentation.graphRevision,
      toolId: 'focus-retouch',
    }),
    [
      geometry.geometryEpoch,
      imageSessionId,
      presentation.graphRevision,
      state.active,
      state.packagePath,
      state.session?.revision?.revisionId,
    ],
  );
  const currentRef = useRef(current);
  currentRef.current = current;
  useLayoutEffect(() => {
    controller.synchronize(current);
    refreshOverlay();
  }, [controller, current]);

  const execute = useCallback(
    (command: ViewerFocusRetouchCommand | null) => {
      if (command === null) return;
      void commands
        .applyStroke(command.request)
        .then((session) => {
          if (!controller.receive(command.key, currentRef.current)) return;
          refreshOverlay();
          setUI((value) => ({ focusRetouchToolState: { ...value.focusRetouchToolState, session } }));
        })
        .catch(() => {
          if (!controller.fail(command.key, currentRef.current)) return;
          refreshOverlay();
          setUI((value) => ({ focusRetouchToolState: { ...value.focusRetouchToolState, active: false } }));
        });
    },
    [commands, controller, setUI],
  );

  useEffect(
    () => () => {
      controller.cancel();
    },
    [controller],
  );

  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      if (event.type === 'blur' || event.type === 'escape') {
        controller.cancel();
        refreshOverlay();
        return;
      }
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
        controller.cancel();
        refreshOverlay();
        return;
      }
      if (!('pointerId' in event)) return;
      const point = fixedPoint(event, geometry);
      if (event.type === 'pointerdown') {
        if (point === null) return;
        controller.begin(currentRef.current, event.pointerId, point, {
          erase: state.erase,
          hardnessPercent: state.hardnessPercent,
          radiusPx: state.radiusPx,
          selectedSource: state.selectedSource,
        });
        refreshOverlay();
        return;
      }
      if (event.type === 'pointermove') {
        if (point !== null && controller.move(event.pointerId, point)) refreshOverlay();
        return;
      }
      if (event.type === 'pointerup') {
        execute(controller.end(currentRef.current, event.pointerId));
        refreshOverlay();
      }
    },
    [controller, execute, geometry, state.erase, state.hardnessPercent, state.radiusPx, state.selectedSource],
  );

  return { active: state.active, handleInputEvent, overlays: controller.overlays() };
};
