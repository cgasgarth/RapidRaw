import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Adjustments } from '../../../utils/adjustments';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import {
  buildWhiteBalancePickerAdjustmentCommand,
  type WhiteBalancePickerRuntimeReceipt,
} from '../../../utils/whiteBalancePicker';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import {
  createViewerWhiteBalanceInteractionController,
  resolveViewerWhiteBalanceCropPoint,
  type ViewerWhiteBalanceInteractionContext,
  type ViewerWhiteBalanceInteractionRequest,
} from './viewerWhiteBalanceInteractionController';
import { sampleViewerWhiteBalancePatch, type ViewerWhiteBalanceSampleService } from './viewerWhiteBalanceSampleService';

interface UseViewerWhiteBalanceControllerInput {
  readonly active: boolean;
  readonly baseAdjustments: Adjustments;
  readonly geometry: EditorOverlayGeometry;
  readonly imageSessionId: string;
  readonly onCommit?: (receipt: WhiteBalancePickerRuntimeReceipt, nextAdjustments: Adjustments) => void;
  readonly onPreview?: (receipt: WhiteBalancePickerRuntimeReceipt, nextAdjustments: Adjustments) => void;
  readonly onPreviewCancel?: () => void;
  readonly presentation: EditorPresentationDescriptor;
  readonly previewUrl: string | null;
  readonly sample?: ViewerWhiteBalanceSampleService;
  readonly selectedImagePath: string;
}

export interface ViewerWhiteBalanceControllerBinding {
  readonly active: boolean;
  readonly gesturePointerId: number | null;
  readonly lastStatus: string;
  readonly pendingIntent: 'commit' | 'preview' | null;
  readonly pendingPointerId: number | null;
  cancelPreview(): void;
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
}

const hoverIntervalMs = 150;

export const useViewerWhiteBalanceController = ({
  active,
  baseAdjustments,
  geometry,
  imageSessionId,
  onCommit,
  onPreview,
  onPreviewCancel,
  presentation,
  previewUrl,
  sample = sampleViewerWhiteBalancePatch,
  selectedImagePath,
}: UseViewerWhiteBalanceControllerInput): ViewerWhiteBalanceControllerBinding => {
  const controller = useMemo(() => createViewerWhiteBalanceInteractionController(), []);
  const [, render] = useState(0);
  const [lastStatus, setLastStatus] = useState('idle');
  const refresh = useCallback(() => render((revision) => revision + 1), []);
  const lastHoverAtRef = useRef(Number.NEGATIVE_INFINITY);
  const context: ViewerWhiteBalanceInteractionContext = {
    active,
    cropSize: {
      height: geometry.cropRectInOrientedPixels.height,
      width: geometry.cropRectInOrientedPixels.width,
    },
    geometryEpoch: geometry.geometryEpoch,
    imageSessionId,
    previewIdentity: previewUrl ?? '',
    sourceIdentity: presentation.sourceIdentity,
    sourceRevision: presentation.graphRevision,
  };
  const contextRef = useRef(context);
  contextRef.current = context;

  useLayoutEffect(() => {
    controller.synchronize(context);
  }, [
    active,
    context.cropSize.height,
    context.cropSize.width,
    controller,
    geometry.geometryEpoch,
    imageSessionId,
    presentation.graphRevision,
    presentation.sourceIdentity,
    previewUrl,
  ]);

  useEffect(
    () => () => {
      controller.cancel();
    },
    [controller],
  );

  const cancelPreview = useCallback(() => {
    if (!controller.cancelPreview()) return;
    setLastStatus('preview-cancelled');
    refresh();
    lastHoverAtRef.current = Number.NEGATIVE_INFINITY;
    onPreviewCancel?.();
  }, [controller, onPreviewCancel, refresh]);

  const cancelInteraction = useCallback(() => {
    controller.cancel();
    setLastStatus('interaction-cancelled');
    refresh();
    lastHoverAtRef.current = Number.NEGATIVE_INFINITY;
    onPreviewCancel?.();
  }, [controller, onPreviewCancel, refresh]);

  const executeRequest = useCallback(
    (request: ViewerWhiteBalanceInteractionRequest, capturedAdjustments: Adjustments) => {
      void sample(request)
        .then((result) => {
          if (result === null) {
            controller.accept(request.identity, contextRef.current);
            setLastStatus('sample-null');
            refresh();
            return;
          }
          if (!controller.accept(request.identity, contextRef.current)) {
            const current = contextRef.current;
            const staleDimensions = [
              request.identity.geometryEpoch === current.geometryEpoch ? null : 'geometry',
              request.identity.imageSessionId === current.imageSessionId ? null : 'session',
              request.identity.previewIdentity === current.previewIdentity ? null : 'preview',
              request.identity.sourceIdentity === current.sourceIdentity ? null : 'source',
              request.identity.sourceRevision === current.sourceRevision ? null : 'revision',
            ].filter((value): value is string => value !== null);
            setLastStatus(`stale-result:${staleDimensions.join(',') || 'generation'}`);
            return;
          }
          refresh();
          const command = buildWhiteBalancePickerAdjustmentCommand({
            ...result,
            currentAdjustments: capturedAdjustments,
            currentPreviewIdentity: contextRef.current.previewIdentity,
            previewIdentity: request.identity.previewIdentity,
            selectedImagePath,
          });
          if (request.identity.intent === 'commit') {
            setLastStatus('commit-accepted');
            onCommit?.(command.receipt, command.nextAdjustments);
          } else {
            setLastStatus('preview-accepted');
            onPreview?.(command.receipt, command.nextAdjustments);
          }
        })
        .catch(() => {
          controller.accept(request.identity, contextRef.current);
          setLastStatus('sample-error');
          refresh();
        });
    },
    [controller, onCommit, onPreview, refresh, sample, selectedImagePath],
  );

  const resolvePoint = useCallback(
    (event: Extract<ViewerSurfaceInputEvent, { pointerId: number }>) => {
      if (event.surfaceRect === undefined) return;
      return resolveViewerWhiteBalanceCropPoint({
        clientPoint: { x: event.clientX, y: event.clientY },
        cropSize: contextRef.current.cropSize,
        displayedImageRect: geometry.displayedImageRectInViewCssPixels,
        surfaceRect: event.surfaceRect,
      });
    },
    [geometry.displayedImageRectInViewCssPixels],
  );

  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      if (!active) return;
      if (event.type === 'blur' || event.type === 'escape' || event.type === 'pointercancel') {
        cancelInteraction();
        return;
      }
      if (event.type === 'lostpointercapture') {
        if (controller.handleLostPointerCapture(event.pointerId)) cancelInteraction();
        else setLastStatus('lost-ignored');
        return;
      }
      if (event.type === 'pointerup') {
        const request = controller.completeGesture(contextRef.current, event.pointerId);
        setLastStatus(request === null ? 'pointerup-rejected' : 'sampling-commit');
        refresh();
        if (request !== null) executeRequest(request, baseAdjustments);
        return;
      }
      if (event.type === 'pointerdown') {
        if (event.button !== 0) return;
        const point = resolvePoint(event);
        if (point !== undefined && point !== null) {
          setLastStatus(
            controller.beginGesture(contextRef.current, point, event.pointerId)
              ? 'gesture-started'
              : 'gesture-rejected',
          );
          refresh();
        }
        return;
      }
      if (event.type !== 'pointermove') return;
      if (event.pointerType === 'touch') return;
      const now = performance.now();
      if (now - lastHoverAtRef.current < hoverIntervalMs) return;
      lastHoverAtRef.current = now;
      const point = resolvePoint(event);
      if (point === undefined || point === null) return;
      const request = controller.beginPreview(contextRef.current, point, event.pointerId);
      if (request !== null) {
        refresh();
        executeRequest(request, baseAdjustments);
      }
    },
    [active, baseAdjustments, cancelInteraction, controller, executeRequest, refresh, resolvePoint],
  );

  const snapshot = controller.snapshot();
  return { active, cancelPreview, handleInputEvent, lastStatus, ...snapshot };
};
