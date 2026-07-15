import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildViewerSamplerIdentity,
  LatestViewerSampleScheduler,
  type ViewerSampleTarget,
} from '../../../utils/viewerSampler';
import type { ViewerSamplerState } from './ViewerSamplerHud';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import { createViewerSamplerCommandService, type ViewerSamplerCommandService } from './viewerSamplerCommandService';
import {
  resolveViewerSamplerInteraction,
  type ViewerSamplerInteractionContext,
} from './viewerSamplerInteractionController';
import {
  createViewerSamplerSessionController,
  type ViewerSamplerOperation,
  type ViewerSamplerOverlayDescriptor,
  type ViewerSamplerSessionContext,
} from './viewerSamplerSessionController';

interface UseViewerSamplerControllerInput extends ViewerSamplerInteractionContext {
  readonly backend: 'cpu' | 'cpu-fallback' | 'wgpu';
  readonly commandService?: ViewerSamplerCommandService;
  readonly imageSessionId: string;
  readonly onStateChange?: (state: ViewerSamplerState) => void;
  readonly proofRecipeId: string | null;
  readonly suppressed: boolean;
}

export interface ViewerSamplerControllerBinding {
  readonly overlay: ViewerSamplerOverlayDescriptor | null;
  readonly state: ViewerSamplerState;
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
  handlePointerLeave(): void;
}

export const useViewerSamplerController = ({
  backend,
  commandService,
  compareDividerPosition,
  compareMode,
  compareOrientation,
  displayedImageRect,
  editedRenderSize,
  geometryEpoch,
  graphRevision,
  imageIdentity,
  imageSessionId,
  onStateChange,
  originalRenderSize,
  proofEnabled,
  proofRecipeId,
  sourceImageSize,
  suppressed,
}: UseViewerSamplerControllerInput): ViewerSamplerControllerBinding => {
  const initialTarget: ViewerSampleTarget = proofEnabled ? 'softProof' : 'edited';
  const controller = useMemo(() => createViewerSamplerSessionController(initialTarget), []);
  const service = useMemo(() => commandService ?? createViewerSamplerCommandService(), [commandService]);
  const samplerIdentity = buildViewerSamplerIdentity({
    backend,
    compareDividerPosition,
    compareMode,
    compareOrientation,
    geometryEpoch,
    graphRevision,
    imageIdentity,
    imageSessionId,
    proofRecipeId,
    softProofEnabled: proofEnabled,
  });
  const sessionContext: ViewerSamplerSessionContext = {
    geometryEpoch,
    graphRevision,
    imageSessionId,
    samplerIdentity,
    sourceIdentity: imageIdentity,
    suppressed,
  };
  const interactionContext: ViewerSamplerInteractionContext = {
    compareDividerPosition,
    compareMode,
    compareOrientation,
    displayedImageRect,
    editedRenderSize,
    geometryEpoch,
    graphRevision,
    imageIdentity,
    originalRenderSize,
    proofEnabled,
    sourceImageSize,
  };
  const sessionContextRef = useRef(sessionContext);
  sessionContextRef.current = sessionContext;
  const interactionContextRef = useRef(interactionContext);
  interactionContextRef.current = interactionContext;
  const mountedRef = useRef(true);
  const teardownGenerationRef = useRef(0);
  const [controllerState, setControllerState] = useState(controller.snapshot());
  const publishRef = useRef<() => void>(() => undefined);
  const executeRef = useRef<(operation: ViewerSamplerOperation) => Promise<void>>(async () => undefined);
  const schedulerRef = useRef<LatestViewerSampleScheduler<ViewerSamplerOperation> | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = new LatestViewerSampleScheduler((operation) => executeRef.current(operation));
  }
  const handleToggleLock = useCallback(() => {
    if (controller.toggleLock()) publishRef.current();
  }, [controller]);
  const publish = useCallback(() => {
    if (!mountedRef.current) return;
    const next = controller.snapshot();
    setControllerState(next);
    onStateChange?.({
      locked: next.locked,
      onToggleLock: handleToggleLock,
      result: next.result,
      suppressed: sessionContextRef.current.suppressed,
      target: next.target,
    });
  }, [controller, handleToggleLock, onStateChange]);
  publishRef.current = publish;
  executeRef.current = async (operation) => {
    try {
      const result = await service.sample(operation.request);
      if (controller.receive(operation, result, sessionContextRef.current)) publishRef.current();
    } catch {
      if (controller.fail(operation, sessionContextRef.current)) publishRef.current();
    }
  };

  useLayoutEffect(() => {
    schedulerRef.current?.clear();
    controller.synchronize(sessionContext);
    publish();
  }, [controller, publish, samplerIdentity, suppressed]);
  useLayoutEffect(() => {
    teardownGenerationRef.current += 1;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const teardownGeneration = teardownGenerationRef.current + 1;
      teardownGenerationRef.current = teardownGeneration;
      queueMicrotask(() => {
        if (teardownGenerationRef.current !== teardownGeneration || mountedRef.current) return;
        schedulerRef.current?.dispose();
        controller.dispose();
      });
    };
  }, [controller]);

  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      if (
        event.type === 'blur' ||
        event.type === 'escape' ||
        event.type === 'lostpointercapture' ||
        event.type === 'pointercancel'
      ) {
        schedulerRef.current?.clear();
        if (controller.cancel(true)) publishRef.current();
        return;
      }
      if (event.type !== 'pointermove' || event.pointerType === 'touch' || event.surfaceRect === undefined) return;
      const resolved = resolveViewerSamplerInteraction(
        interactionContextRef.current,
        { altKey: event.altKey, clientX: event.clientX, clientY: event.clientY },
        event.surfaceRect,
      );
      if (resolved === null) {
        schedulerRef.current?.clear();
        if (controller.cancel(false)) publishRef.current();
        return;
      }
      const operation = controller.begin(
        resolved.request,
        resolved.target,
        resolved.viewPoint,
        sessionContextRef.current,
      );
      if (operation === null) return;
      publishRef.current();
      schedulerRef.current?.schedule(operation);
    },
    [controller],
  );
  const handlePointerLeave = useCallback(() => {
    schedulerRef.current?.clear();
    if (controller.cancel(true)) publishRef.current();
  }, [controller]);

  return {
    handleInputEvent,
    handlePointerLeave,
    overlay: controllerState.overlay,
    state: {
      locked: controllerState.locked,
      onToggleLock: handleToggleLock,
      result: controllerState.result,
      suppressed,
      target: controllerState.target,
    },
  };
};
