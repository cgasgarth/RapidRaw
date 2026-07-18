import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import type { ActiveChannel } from '../../../utils/adjustments';
import { selectEditDocumentNode } from '../../../utils/editDocumentSelectors';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import type { ToneCurveTargetMode } from '../../../utils/toneCurveTarget';
import {
  createViewerSampleRequest,
  mapViewerPointToImage,
  resolveViewerSampleTarget,
} from '../../../utils/viewerSampler';
import {
  createToneCurveTargetInteractionController,
  type ToneCurveTargetCommand,
  type ToneCurveTargetCommitResult,
  type ToneCurveTargetCurrentContext,
  type ToneCurveTargetOverlayDescriptor,
} from './toneCurveTargetInteractionController';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import { createViewerSamplerCommandService, type ViewerSamplerCommandService } from './viewerSamplerCommandService';

interface UseViewerToneCurveTargetControllerInput {
  readonly active: boolean;
  readonly adjustmentRevision: number;
  readonly channel: ActiveChannel;
  readonly compareDividerPosition: number;
  readonly compareMode: 'off' | 'hold-original' | 'split-wipe' | 'side-by-side';
  readonly compareOrientation: 'horizontal' | 'vertical';
  readonly editDocumentV2: EditDocumentV2;
  readonly geometry: EditorOverlayGeometry;
  readonly imageSessionId: string;
  readonly mode: ToneCurveTargetMode;
  readonly onCommit: (command: ToneCurveTargetCommitResult) => void;
  readonly presentation: EditorPresentationDescriptor;
  readonly proofEnabled: boolean;
  readonly sourceImageSize: { readonly height: number; readonly width: number };
  readonly selectedPointIndex: number | null;
  readonly commandService?: ViewerSamplerCommandService;
}

export interface ViewerToneCurveTargetControllerBinding {
  readonly active: boolean;
  readonly overlays: readonly ToneCurveTargetOverlayDescriptor[];
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
}

export const useViewerToneCurveTargetController = ({
  active,
  adjustmentRevision,
  channel,
  compareDividerPosition,
  compareMode,
  compareOrientation,
  editDocumentV2,
  geometry,
  imageSessionId,
  mode,
  onCommit,
  presentation,
  proofEnabled,
  sourceImageSize,
  selectedPointIndex,
  commandService,
}: UseViewerToneCurveTargetControllerInput): ViewerToneCurveTargetControllerBinding => {
  const controller = useMemo(() => createToneCurveTargetInteractionController(), []);
  const service = useMemo(() => commandService ?? createViewerSamplerCommandService(), [commandService]);
  const operationGeneration = useRef(0);
  const currentContext: ToneCurveTargetCurrentContext = {
    active,
    adjustmentRevision,
    channel,
    geometryEpoch: geometry.geometryEpoch,
    imageSessionId,
    mode,
    sourceIdentity: presentation.sourceIdentity,
    sourceRevision: presentation.graphRevision,
    selectedPointIndex,
  };
  const currentContextRef = useRef(currentContext);
  currentContextRef.current = currentContext;
  const currentDocumentRef = useRef(editDocumentV2);
  currentDocumentRef.current = editDocumentV2;
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const execute = useCallback(
    (commands: readonly ToneCurveTargetCommand[]) => {
      for (const command of commands) {
        if (command.kind === 'sample') {
          void service
            .sample(command.request)
            .then((result) => {
              controller.receive(command.key, result, currentContextRef.current);
              refresh();
            })
            .catch(() => {
              execute(controller.cancel());
              refresh();
            });
        } else if (command.kind === 'commit') {
          onCommit(command.command);
        }
      }
    },
    [controller, onCommit, refresh, service],
  );
  const contextIdentity = JSON.stringify([
    active,
    adjustmentRevision,
    channel,
    geometry.geometryEpoch,
    imageSessionId,
    mode,
    presentation.sourceIdentity,
    presentation.graphRevision,
    selectedPointIndex,
  ]);
  const previousContextIdentity = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (previousContextIdentity.current === contextIdentity) return;
    previousContextIdentity.current = contextIdentity;
    execute(controller.cancel());
    refresh();
  }, [contextIdentity, controller, execute, refresh]);
  useEffect(() => () => execute(controller.cancel()), [controller, execute]);

  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      if (
        event.type === 'escape' ||
        event.type === 'blur' ||
        event.type === 'pointercancel' ||
        event.type === 'lostpointercapture'
      ) {
        execute(controller.cancel());
        refresh();
        return;
      }
      if (event.type === 'keydown') {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const params = selectEditDocumentNode(currentDocumentRef.current, 'scene_curve').params;
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        execute(controller.commitKeyboard(event.shiftKey ? direction * 10 : direction, params));
        refresh();
        return;
      }
      if (!active || !('pointerId' in event) || event.surfaceRect === undefined) return;
      if (event.type === 'pointermove') {
        controller.move(event.pointerId, event.clientY);
        refresh();
        return;
      }
      if (event.type === 'pointerup') {
        const params = selectEditDocumentNode(currentDocumentRef.current, 'scene_curve').params;
        execute(controller.release(event.pointerId, event.clientY, params));
        refresh();
        return;
      }
      if (event.type !== 'pointerdown' || event.button !== 0) return;
      const mapped = mapViewerPointToImage({
        clientPoint: { x: event.clientX, y: event.clientY },
        displayedImageRect: geometry.displayedImageRectInViewCssPixels,
        surfaceRect: event.surfaceRect,
      });
      if (mapped === null) return;
      const target = resolveViewerSampleTarget({
        compareDividerPosition,
        compareMode,
        compareOrientation,
        normalizedViewerX: mapped.normalizedViewerX,
        normalizedViewerY: mapped.normalizedViewerY,
        softProofEnabled: proofEnabled,
      });
      if (target === 'original') return;
      operationGeneration.current += 1;
      const request = createViewerSampleRequest({
        geometryEpoch: geometry.geometryEpoch,
        graphRevision: presentation.graphRevision,
        imageIdentity: presentation.sourceIdentity,
        normalizedImagePoint: mapped.normalizedImagePoint,
        requestedSpace: 'displayEncoded',
        sampleRadiusImagePx: event.altKey ? 4 : 0,
        sourceImageSize,
        target,
      });
      execute(
        controller.begin({
          baseline: currentDocumentRef.current,
          clientY: event.clientY,
          key: {
            adjustmentRevision,
            channel,
            geometryEpoch: geometry.geometryEpoch,
            imageSessionId,
            mode,
            operationGeneration: operationGeneration.current,
            sourceIdentity: presentation.sourceIdentity,
            sourceRevision: presentation.graphRevision,
            selectedPointIndex,
            toolId: 'tone-curve',
          },
          point: {
            normalizedImagePoint: mapped.normalizedImagePoint,
            viewPoint: {
              x:
                geometry.displayedImageRectInViewCssPixels.x +
                mapped.normalizedImagePoint.x * geometry.displayedImageRectInViewCssPixels.width,
              y:
                geometry.displayedImageRectInViewCssPixels.y +
                mapped.normalizedImagePoint.y * geometry.displayedImageRectInViewCssPixels.height,
            },
          },
          pointerId: event.pointerId,
          request,
        }),
      );
      refresh();
    },
    [
      active,
      adjustmentRevision,
      channel,
      compareDividerPosition,
      compareMode,
      compareOrientation,
      controller,
      execute,
      geometry,
      imageSessionId,
      mode,
      presentation.graphRevision,
      presentation.sourceIdentity,
      proofEnabled,
      refresh,
      sourceImageSize,
      selectedPointIndex,
    ],
  );

  // Keep the binding reactive without allowing stale session data to survive a
  // document or presentation identity change.
  void revision;
  return { active, handleInputEvent, overlays: controller.overlays() };
};
