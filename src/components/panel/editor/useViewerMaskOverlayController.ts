import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import type { MaskOverlaySettings } from '../../../schemas/masks/maskOverlaySchemas';
import type { Adjustments } from '../../../utils/adjustments';
import {
  buildMaskOverlayInvokePayload,
  buildMaskOverlayRequestIdentity,
  buildMaskOverlayTriggerHash,
  type MaskPreviewDefinition,
} from '../../../utils/mask/maskOverlayRequest';
import {
  createViewerMaskOverlayCommandService,
  type ViewerMaskOverlayCommandService,
} from './viewerMaskOverlayCommandService';
import {
  createViewerMaskOverlayController,
  createViewerMaskOverlayInvalidationDescriptor,
  isViewerMaskOverlayKeyCurrent,
  type ViewerMaskOverlayContext,
  type ViewerMaskOverlayDescriptor,
  type ViewerMaskOverlayGenerateCommand,
  type ViewerMaskOverlayTransition,
} from './viewerMaskOverlayController';

export interface ViewerMaskOverlayRequestInput {
  readonly adjustments: Adjustments;
  readonly maskDef: MaskPreviewDefinition;
  readonly maskOverlaySettings: MaskOverlaySettings;
  readonly patchesSentToBackend: ReadonlySet<string>;
  readonly renderSize: RenderSize;
}

interface UseViewerMaskOverlayControllerInput {
  readonly context: ViewerMaskOverlayContext;
  readonly service?: ViewerMaskOverlayCommandService;
}

export interface ViewerMaskOverlayControllerBinding {
  readonly descriptor: ViewerMaskOverlayDescriptor;
  request(input: ViewerMaskOverlayRequestInput): void;
}

export const useViewerMaskOverlayController = ({
  context,
  service,
}: UseViewerMaskOverlayControllerInput): ViewerMaskOverlayControllerBinding => {
  const controller = useMemo(() => createViewerMaskOverlayController(context), []);
  const commandService = useMemo(() => service ?? createViewerMaskOverlayCommandService(), [service]);
  const currentRef = useRef({ commandService, context });
  currentRef.current = { commandService, context };
  const mountedRef = useRef(true);
  const teardownGenerationRef = useRef(0);
  const runCommandRef = useRef<(command: ViewerMaskOverlayGenerateCommand) => void>(() => undefined);
  const [descriptor, setDescriptor] = useState(controller.snapshot());

  const publish = useCallback((transition: ViewerMaskOverlayTransition) => {
    if (transition.command !== null) runCommandRef.current(transition.command);
    if (mountedRef.current) setDescriptor(transition.descriptor);
  }, []);

  const runCommand = useCallback(
    (command: ViewerMaskOverlayGenerateCommand) => {
      void currentRef.current.commandService
        .generate(command.request.payload)
        .then((url) => publish(controller.resolve(command.request.key, url)))
        .catch(() => publish(controller.fail(command.request.key)));
    },
    [controller, publish],
  );
  runCommandRef.current = runCommand;

  const contextFingerprint = JSON.stringify(context);
  useLayoutEffect(() => {
    publish(controller.synchronize(currentRef.current.context));
  }, [contextFingerprint, controller, publish]);
  useLayoutEffect(() => {
    teardownGenerationRef.current += 1;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const teardownGeneration = teardownGenerationRef.current + 1;
      teardownGenerationRef.current = teardownGeneration;
      queueMicrotask(() => {
        if (teardownGenerationRef.current !== teardownGeneration || mountedRef.current) return;
        controller.dispose();
      });
    };
  }, [controller]);

  const request = useCallback(
    (input: ViewerMaskOverlayRequestInput) => {
      const current = currentRef.current.context;
      publish(controller.synchronize(current));
      const triggerHash = buildMaskOverlayTriggerHash({
        activeMaskDef: input.maskDef,
        adjustments: input.adjustments,
        imageRenderSize: input.renderSize,
        maskOverlaySettings: input.maskOverlaySettings,
      });
      const requestIdentity = buildMaskOverlayRequestIdentity({
        imageSessionId: current.imageSessionId,
        renderSize: input.renderSize,
        selectedImagePath: current.sourceIdentity,
        triggerHash,
      });
      const payload = buildMaskOverlayInvokePayload({
        jsAdjustments: input.adjustments,
        maskDef: input.maskDef,
        maskOverlaySettings: input.maskOverlaySettings,
        patchesSentToBackend: input.patchesSentToBackend,
        renderSize: input.renderSize,
      });
      publish(controller.request(current, requestIdentity, payload));
    },
    [controller, publish],
  );

  const currentDescriptor =
    descriptor.imageSessionId === context.imageSessionId &&
    (descriptor.key === null || isViewerMaskOverlayKeyCurrent(descriptor.key, context))
      ? descriptor
      : createViewerMaskOverlayInvalidationDescriptor(context);
  return { descriptor: currentDescriptor, request };
};
