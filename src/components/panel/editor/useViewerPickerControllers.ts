import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { useUIStore } from '../../../store/useUIStore';
import type { PointColorPickerResponse } from '../../../utils/color/pointColorPicker';
import {
  resolveChromaFromDisplayRgb,
  resolveHueFromDisplayRgb,
  resolveLightnessFromDisplayRgb,
} from '../../../utils/colorMixerTargetedAdjustment';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import { createViewerSampleRequest, mapViewerPointToImage } from '../../../utils/viewerSampler';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import { createViewerPickerCommandServices } from './viewerPickerCommandServices';
import {
  createViewerPickerContextSynchronizer,
  createViewerPickerInteractionController,
  resolveViewerPickerPoint,
  type ViewerPickerCommand,
  type ViewerPickerCommitResult,
  type ViewerPickerCurrentContext,
  type ViewerPickerOverlayDescriptor,
  type ViewerPickerSessionKey,
  type ViewerPickerToolId,
} from './viewerPickerInteractionControllers';
import { createViewerSamplerCommandService } from './viewerSamplerCommandService';

interface UseViewerPickerControllersInput {
  readonly adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  readonly geometry: EditorOverlayGeometry;
  readonly imageSessionId: string;
  readonly onCommit: (command: ViewerPickerCommitResult) => void;
  readonly presentation: EditorPresentationDescriptor;
}

export interface ViewerPickerControllers {
  readonly activeTool: ViewerPickerToolId | null;
  readonly overlays: readonly ViewerPickerOverlayDescriptor[];
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
}

export const useViewerPickerControllers = ({
  adjustmentRevision,
  editDocumentV2,
  geometry,
  imageSessionId,
  onCommit,
  presentation,
}: UseViewerPickerControllersInput): ViewerPickerControllers => {
  const toneEqualizerPickerActive = useUIStore((state) => state.toneEqualizerPickerActive);
  const pointColorPickerActive = useUIStore((state) => state.pointColorPickerActive);
  const colorMixerTargetedMode = useUIStore((state) => state.colorMixerTargetedMode);
  const setUI = useUIStore((state) => state.setUI);
  const activeTool: ViewerPickerToolId | null =
    colorMixerTargetedMode !== null
      ? 'color-mixer'
      : pointColorPickerActive
        ? 'point-color'
        : toneEqualizerPickerActive
          ? 'tone-equalizer'
          : null;
  const controller = useMemo(() => createViewerPickerInteractionController(), []);
  const contextSynchronizer = useMemo(() => createViewerPickerContextSynchronizer(controller), [controller]);
  const pickerCommands = useMemo(() => createViewerPickerCommandServices(), []);
  const samplerCommands = useMemo(() => createViewerSamplerCommandService(), []);
  const operationGeneration = useRef(0);
  const [, render] = useState(0);
  const currentContext: ViewerPickerCurrentContext = {
    activeTool,
    adjustmentRevision,
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
          case 'sample-color-mixer':
            {
              const request = createViewerSampleRequest({
                geometryEpoch: geometry.geometryEpoch,
                graphRevision: command.key.sourceRevision,
                imageIdentity: command.key.sourceIdentity,
                normalizedImagePoint: command.normalizedImagePoint,
                requestedSpace: 'displayEncoded',
                sampleRadiusImagePx: 2,
                sourceImageSize: geometry.sourceSize,
                target: 'edited',
              });
              void samplerCommands
                .sample(request)
                .then((sample): PointColorPickerResponse => {
                  if (sample.requestIdentity !== request.requestIdentity) throw new Error('color_mixer.stale_sample');
                  if (sample.status !== 'available') throw new Error(`color_mixer.sample_${sample.reason}`);
                  return {
                    chroma: resolveChromaFromDisplayRgb(sample.rgb),
                    confidence: 1,
                    graphFingerprint: command.key.sourceRevision,
                    graphRevision: command.key.sourceRevision,
                    hueDegrees: resolveHueFromDisplayRgb(sample.rgb),
                    lightness: resolveLightnessFromDisplayRgb(sample.rgb),
                    sampleRadiusPx: 2,
                    sourceFingerprint: sample.requestIdentity,
                    sourceIdentity: command.key.sourceIdentity,
                  };
                })
                .then((result) => {
                  executePickerCommands(controller.receiveColorMixer(command.key, result, currentContextRef.current));
                  refresh();
                })
                .catch(() => {
                  executePickerCommands(controller.fail(command.key, currentContextRef.current));
                  refresh();
                });
            }
            break;
          case 'sample-point-color':
            void pickerCommands
              .samplePointColor({
                graphRevision: command.key.sourceRevision,
                editDocumentV2: command.editDocumentV2,
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
                editDocumentV2: command.editDocumentV2,
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
            onCommit({
              baseline: command.baseline,
              deltaEv: command.deltaEv,
              key: command.key,
              kind: 'tone-equalizer',
              result: command.result,
            });
            break;
          case 'commit-color-mixer':
            onCommit({
              baseline: command.baseline,
              bands: command.bands,
              delta: command.delta,
              key: command.key,
              kind: 'color-mixer',
              mode: command.mode,
              result: command.result,
            });
            setUI({ colorMixerTargetedMode: null, colorMixerTargetedReceipt: null });
            break;
          case 'commit-point-color':
            onCommit({
              key: command.key,
              kind: 'point-color',
              ordinal: command.ordinal,
              result: command.result,
            });
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
          case 'publish-color-mixer-receipt':
            setUI({
              colorMixerTargetedReceipt: {
                bands: command.bands,
                delta: command.delta,
                graphRevision: command.result.graphRevision,
                hueDegrees: command.result.hueDegrees,
                mode: command.mode,
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
          case 'clear-color-mixer-receipt':
            setUI({ colorMixerTargetedMode: null, colorMixerTargetedReceipt: null });
            break;
        }
      }
    },
    [
      controller,
      geometry.geometryEpoch,
      geometry.sourceSize,
      onCommit,
      pickerCommands,
      refresh,
      samplerCommands,
      setUI,
    ],
  );

  useLayoutEffect(() => {
    const commands = contextSynchronizer.synchronize(currentContext);
    if (commands.length === 0) return;
    executeCommands(commands);
    refresh();
  }, [
    activeTool,
    adjustmentRevision,
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
        adjustmentRevision,
        geometryEpoch: geometry.geometryEpoch,
        imageSessionId,
        normalizedImagePoint: mapped.normalizedImagePoint,
        operationGeneration: operationGeneration.current,
        sourceIdentity: presentation.sourceIdentity,
        sourceRevision: presentation.graphRevision,
        toolId: activeTool,
      } satisfies ViewerPickerSessionKey;
      const point = resolveViewerPickerPoint(mapped.normalizedImagePoint, geometry.displayedImageRectInViewCssPixels);
      executeCommands(
        activeTool === 'color-mixer'
          ? controller.beginColorMixer({
              clientY: event.clientY,
              editDocumentV2,
              key: { ...key, toolId: 'color-mixer' },
              mode: colorMixerTargetedMode ?? 'hue',
              point,
              pointerId: event.pointerId,
            })
          : activeTool === 'point-color'
            ? controller.beginPointColor({
                editDocumentV2,
                key: { ...key, toolId: 'point-color' },
                point,
                pointerId: event.pointerId,
              })
            : controller.beginToneEqualizer({
                editDocumentV2,
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
      colorMixerTargetedMode,
      adjustmentRevision,
      editDocumentV2,
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
