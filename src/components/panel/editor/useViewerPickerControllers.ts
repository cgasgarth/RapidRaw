import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import type { Adjustments } from '../../../utils/adjustments';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import { mapViewerPointToImage } from '../../../utils/viewerSampler';
import { createViewerAdjustmentCommandServices } from './viewerAdjustmentCommandService';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import {
  createViewerPickerInteractionController,
  createViewerPickerContextSynchronizer,
  resolveViewerPickerPoint,
  type ViewerPickerCommand,
  type ViewerPickerCurrentContext,
  type ViewerPickerOverlayDescriptor,
  type ViewerPickerSessionKey,
  type ViewerPickerToolId,
} from './viewerPickerInteractionControllers';
import { createViewerPickerCommandServices } from './viewerPickerCommandServices';

interface UseViewerPickerControllersInput {
  readonly adjustments: Adjustments;
  readonly geometry: EditorOverlayGeometry;
  readonly presentation: EditorPresentationDescriptor;
  readonly setAdjustments: (updater: (previous: Adjustments) => Adjustments) => void;
}

export interface ViewerPickerControllers {
  readonly activeTool: ViewerPickerToolId | null;
  readonly overlays: readonly ViewerPickerOverlayDescriptor[];
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
}

export const useViewerPickerControllers = ({
  adjustments,
  geometry,
  presentation,
  setAdjustments,
}: UseViewerPickerControllersInput): ViewerPickerControllers => {
  const toneEqualizerPickerActive = useUIStore((state) => state.toneEqualizerPickerActive);
  const pointColorPickerActive = useUIStore((state) => state.pointColorPickerActive);
  const setUI = useUIStore((state) => state.setUI);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const activeTool: ViewerPickerToolId | null = pointColorPickerActive
    ? 'point-color'
    : toneEqualizerPickerActive
      ? 'tone-equalizer'
      : null;
  const controller = useMemo(() => createViewerPickerInteractionController(), []);
  const contextSynchronizer = useMemo(() => createViewerPickerContextSynchronizer(controller), [controller]);
  const pickerCommands = useMemo(() => createViewerPickerCommandServices(), []);
  const adjustmentCommands = useMemo(() => createViewerAdjustmentCommandServices(setAdjustments), [setAdjustments]);
  const operationGeneration = useRef(0);
  const [, render] = useState(0);
  const currentContext: ViewerPickerCurrentContext = {
    activeTool,
    geometryEpoch: geometry.geometryEpoch,
    imageSessionId,
    sourceIdentity: presentation.sourceIdentity,
    sourceRevision: presentation.graphRevision,
  };
  const currentContextRef = useRef(currentContext);
  currentContextRef.current = currentContext;
  const refresh = useCallback(() => render((revision) => revision + 1), []);
  const executeCommands = useCallback(
    function executePickerCommands(commands: readonly ViewerPickerCommand[]) {
      for (const command of commands) {
        switch (command.kind) {
          case 'sample-point-color':
            void pickerCommands
              .samplePointColor({
                graphRevision: command.key.sourceRevision,
                jsAdjustments: command.adjustments,
                normalizedImagePoint: command.normalizedImagePoint,
                sourceIdentity: command.key.sourceIdentity,
              })
              .then((result) => {
                executePickerCommands(controller.receivePointColor(command.key, result, currentContextRef.current));
                refresh();
              })
              .catch(() => {
                executePickerCommands(controller.fail(command.key, currentContextRef.current));
                refresh();
              });
            break;
          case 'sample-tone-equalizer':
            void pickerCommands
              .sampleToneEqualizer({
                graphRevision: command.key.sourceRevision,
                jsAdjustments: command.adjustments,
                normalizedImagePoint: command.normalizedImagePoint,
                sourceIdentity: command.key.sourceIdentity,
              })
              .then((result) => {
                executePickerCommands(controller.receiveToneEqualizer(command.key, result, currentContextRef.current));
                refresh();
              })
              .catch(() => {
                executePickerCommands(controller.fail(command.key, currentContextRef.current));
                refresh();
              });
            break;
          case 'commit-tone-equalizer':
            adjustmentCommands.commitToneEqualizerPicker(command.baseline, command.result, command.deltaEv);
            break;
          case 'commit-point-color':
            adjustmentCommands.commitPointColorPicker(command.result, command.ordinal);
            break;
          case 'deactivate-point-color':
            setUI({ pointColorPickerActive: false });
            break;
          case 'publish-point-color-receipt':
            setUI({
              pointColorPickerReceipt: {
                confidence: command.result.confidence,
                graphRevision: command.result.graphRevision,
                sourceFingerprint: command.result.sourceFingerprint,
                sourceIdentity: command.result.sourceIdentity,
              },
            });
            break;
          case 'publish-tone-equalizer-receipt':
            setUI({
              toneEqualizerPickerReceipt: {
                exposureEv: command.result.exposureEv,
                graphRevision: command.result.graphRevision,
                primaryBand: command.result.primaryBand,
                sourceFingerprint: command.result.sourceFingerprint,
                sourceIdentity: command.result.sourceIdentity,
              },
            });
            break;
          case 'clear-point-color-receipt':
            setUI({ pointColorPickerReceipt: null });
            break;
          case 'clear-tone-equalizer-receipt':
            setUI({ toneEqualizerPickerReceipt: null });
            break;
        }
      }
    },
    [adjustmentCommands, controller, pickerCommands, refresh, setUI],
  );

  useLayoutEffect(() => {
    const commands = contextSynchronizer.synchronize(currentContext);
    if (commands.length === 0) return;
    executeCommands(commands);
    refresh();
  }, [
    activeTool,
    contextSynchronizer,
    executeCommands,
    geometry.geometryEpoch,
    imageSessionId,
    presentation.graphRevision,
    presentation.sourceIdentity,
    refresh,
  ]);
  useEffect(
    () => () => {
      executeCommands(controller.cancel());
    },
    [controller, executeCommands],
  );

  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      if (event.type === 'blur' || event.type === 'escape') {
        executeCommands(controller.cancel());
        refresh();
        return;
      }
      if (event.type === 'pointermove') {
        controller.move(event.pointerId, event.clientY);
        refresh();
        return;
      }
      if (event.type === 'pointerup') {
        executeCommands(controller.release(event.pointerId, event.clientY));
        refresh();
        return;
      }
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
        executeCommands(controller.cancel());
        refresh();
        return;
      }
      if (!('pointerId' in event)) return;
      if (activeTool === null || event.surfaceRect === undefined) return;
      const mapped = mapViewerPointToImage({
        clientPoint: { x: event.clientX, y: event.clientY },
        displayedImageRect: geometry.displayedImageRectInViewCssPixels,
        surfaceRect: event.surfaceRect,
      });
      if (mapped === null) return;
      operationGeneration.current += 1;
      const key = {
        geometryEpoch: geometry.geometryEpoch,
        imageSessionId,
        operationGeneration: operationGeneration.current,
        sourceIdentity: presentation.sourceIdentity,
        sourceRevision: presentation.graphRevision,
        toolId: activeTool,
      } satisfies ViewerPickerSessionKey;
      const point = resolveViewerPickerPoint(mapped.normalizedImagePoint, geometry.displayedImageRectInViewCssPixels);
      executeCommands(
        activeTool === 'point-color'
          ? controller.beginPointColor({
              adjustments,
              key: { ...key, toolId: 'point-color' },
              point,
              pointerId: event.pointerId,
            })
          : controller.beginToneEqualizer({
              adjustments,
              clientY: event.clientY,
              key: { ...key, toolId: 'tone-equalizer' },
              point,
              pointerId: event.pointerId,
            }),
      );
      refresh();
    },
    [
      activeTool,
      adjustments,
      controller,
      executeCommands,
      geometry,
      imageSessionId,
      presentation.graphRevision,
      presentation.sourceIdentity,
      refresh,
    ],
  );

  return { activeTool, handleInputEvent, overlays: controller.overlays() };
};
