import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import type { AiPatch, MaskContainer } from '../../../utils/adjustments';
import {
  captureSubMaskInteractionIdentity,
  type SubMaskInteractionIdentity,
  type SubMaskInteractionTarget,
} from '../../../utils/subMaskInteractionEditTransaction';
import type { SubMask } from '../right/layers/Masks';
import type { MaskInteractionEvent } from './MaskOverlaySurface';
import {
  createViewerMaskShapeInteractionController,
  isViewerMaskShapeKeyCurrent,
  type ViewerMaskShapeCurrentContext,
  type ViewerMaskShapeSessionKey,
  type ViewerMaskShapeTarget,
} from './viewerMaskShapeInteractionController';
import { viewerPointerIdentity } from './viewerPointerEvents';

interface UseViewerMaskShapeControllerInput {
  readonly activeContainer: AiPatch | MaskContainer | null;
  readonly context: ViewerMaskShapeCurrentContext;
  readonly isToolActive: boolean;
  readonly onCommit: (id: string | null, patch: Partial<SubMask>, identity: SubMaskInteractionIdentity) => void;
  readonly onHoverChange: (hovered: boolean) => void;
  readonly onLiveMaskPreview?: (container: AiPatch | MaskContainer) => void;
  readonly onSelectAiSubMask: (id: string | null) => void;
  readonly onSelectMask: (id: string | null) => void;
  readonly onTouchInteractionChange: (active: boolean) => void;
}

interface MaskShapeSession {
  readonly baselineContainer: AiPatch | MaskContainer;
  readonly identity: SubMaskInteractionIdentity;
  readonly key: ViewerMaskShapeSessionKey;
  previewed: boolean;
}

export interface ViewerMaskShapeControllerBinding {
  readonly active: boolean;
  readonly resetEpoch: number;
  readonly sessionKey: ViewerMaskShapeSessionKey | null;
  readonly transition: string;
  begin(target: ViewerMaskShapeTarget, event?: MaskInteractionEvent): boolean;
  cancel(reason: string): void;
  commit(id: string, patch: Partial<SubMask>): boolean;
  end(): void;
  hover(hovered: boolean): void;
  preview(id: string, patch: Partial<SubMask>): boolean;
  release(event: MouseEvent | PointerEvent | TouchEvent): boolean;
  select(id: string): void;
}

const containerWithPatch = (
  baseline: AiPatch | MaskContainer,
  subMaskId: string,
  patch: Partial<SubMask>,
): AiPatch | MaskContainer => ({
  ...baseline,
  subMasks: baseline.subMasks.map((subMask) =>
    subMask.id === subMaskId ? { ...subMask, ...structuredClone(patch), id: subMaskId } : subMask,
  ),
});

/** Owns exact-session identity, live output, and semantic commits for editable mask shapes. */
export const useViewerMaskShapeController = ({
  activeContainer,
  context,
  isToolActive,
  onCommit,
  onHoverChange,
  onLiveMaskPreview,
  onSelectAiSubMask,
  onSelectMask,
  onTouchInteractionChange,
}: UseViewerMaskShapeControllerInput): ViewerMaskShapeControllerBinding => {
  const controller = useMemo(() => createViewerMaskShapeInteractionController(), []);
  const mountedRef = useRef(true);
  const sessionRef = useRef<MaskShapeSession | null>(null);
  const currentRef = useRef({
    activeContainer,
    context,
    isToolActive,
    onCommit,
    onHoverChange,
    onLiveMaskPreview,
    onSelectAiSubMask,
    onSelectMask,
    onTouchInteractionChange,
  });
  currentRef.current = {
    activeContainer,
    context,
    isToolActive,
    onCommit,
    onHoverChange,
    onLiveMaskPreview,
    onSelectAiSubMask,
    onSelectMask,
    onTouchInteractionChange,
  };
  const [active, setActive] = useState(false);
  const [resetEpoch, setResetEpoch] = useState(0);
  const [sessionKey, setSessionKey] = useState<ViewerMaskShapeSessionKey | null>(null);
  const [transition, setTransition] = useState('idle');

  const clearSession = useCallback(
    (reason: string, key: ViewerMaskShapeSessionKey | null, publishBaseline: boolean) => {
      const session = sessionRef.current;
      if (
        publishBaseline &&
        session?.previewed === true &&
        key !== null &&
        isViewerMaskShapeKeyCurrent(key, currentRef.current.context)
      ) {
        currentRef.current.onLiveMaskPreview?.(session.baselineContainer);
      }
      sessionRef.current = null;
      currentRef.current.onTouchInteractionChange(false);
      if (!mountedRef.current) return;
      setActive(false);
      setSessionKey(null);
      setResetEpoch((epoch) => epoch + 1);
      setTransition(reason);
    },
    [],
  );
  const cancel = useCallback(
    (reason: string) => {
      const key = controller.cancel();
      clearSession(reason, key, true);
    },
    [clearSession, controller],
  );

  const begin = useCallback(
    (target: ViewerMaskShapeTarget, event?: MaskInteractionEvent): boolean => {
      const current = currentRef.current;
      if (!current.context.active || current.activeContainer === null || event?.evt === undefined) return false;
      const pointer = viewerPointerIdentity(event.evt);
      const operationId = `mask-shape:${crypto.randomUUID()}`;
      const key = controller.begin(current.context, target, pointer, operationId);
      if (key === null) return false;
      const identityTarget: SubMaskInteractionTarget = target;
      const identity = captureSubMaskInteractionIdentity(useEditorStore.getState(), operationId, identityTarget);
      if (
        identity === null ||
        identity.containerId !== key.containerId ||
        identity.containerKind !== key.containerKind ||
        identity.imageSessionId !== key.imageSessionId ||
        identity.sourceIdentity !== key.sourceIdentity ||
        identity.subMaskId !== key.subMaskId
      ) {
        controller.cancel();
        clearSession('begin-stale', key, false);
        return false;
      }
      sessionRef.current = {
        baselineContainer: structuredClone(current.activeContainer),
        identity,
        key,
        previewed: false,
      };
      current.onTouchInteractionChange(pointer.pointerType === 'touch');
      setActive(true);
      setSessionKey(key);
      setTransition('started');
      return true;
    },
    [clearSession, controller],
  );
  const preview = useCallback(
    (id: string, patch: Partial<SubMask>): boolean => {
      const descriptor = controller.preview(currentRef.current.context, id, patch);
      const session = sessionRef.current;
      if (descriptor === null || session === null || descriptor.key !== session.key) {
        if (mountedRef.current) setTransition('preview-rejected');
        return false;
      }
      session.previewed = true;
      currentRef.current.onLiveMaskPreview?.(containerWithPatch(session.baselineContainer, id, descriptor.patch));
      if (mountedRef.current) setTransition('preview');
      return true;
    },
    [controller],
  );
  const commit = useCallback(
    (id: string, patch: Partial<SubMask>): boolean => {
      const command = controller.commit(currentRef.current.context, id, patch);
      const session = sessionRef.current;
      if (command === null || session === null || command.key !== session.key) return false;
      try {
        currentRef.current.onCommit(command.subMaskId, command.patch, session.identity);
        currentRef.current.onLiveMaskPreview?.(
          containerWithPatch(session.baselineContainer, command.subMaskId, command.patch),
        );
        const endedKey = controller.end(currentRef.current.context);
        clearSession('committed', endedKey, false);
        return true;
      } catch {
        cancel('commit-rejected');
        return false;
      }
    },
    [cancel, clearSession, controller],
  );
  const end = useCallback(() => {
    const key = controller.end(currentRef.current.context);
    if (key === null && sessionRef.current === null) return;
    clearSession('ended', key, false);
  }, [clearSession, controller]);
  const hover = useCallback((hovered: boolean) => {
    if (!currentRef.current.isToolActive) currentRef.current.onHoverChange(hovered);
  }, []);
  const select = useCallback((id: string) => {
    if (currentRef.current.context.containerKind === 'masks') currentRef.current.onSelectMask(id);
    else currentRef.current.onSelectAiSubMask(id);
  }, []);
  const release = useCallback(
    (event: MouseEvent | PointerEvent | TouchEvent): boolean => {
      const key = sessionRef.current?.key;
      if (key === undefined) return false;
      const pointer = viewerPointerIdentity(event);
      if (pointer.pointerId !== key.pointerId || pointer.pointerType !== key.pointerType) return false;
      const overlay = controller.overlays()[0];
      if (overlay === undefined) end();
      else commit(key.subMaskId, overlay.patch);
      return true;
    },
    [commit, controller, end],
  );

  useLayoutEffect(() => {
    const invalidatedKey = controller.synchronize(context);
    if (invalidatedKey !== null) clearSession('session-invalidated', invalidatedKey, false);
  }, [clearSession, context, controller]);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && controller.isActive()) cancel('escape');
    };
    const handleBlur = () => {
      if (controller.isActive()) cancel('blur');
    };
    const handlePointerCancellation = (event: PointerEvent) => {
      const key = sessionRef.current?.key;
      if (key !== undefined && event.pointerId === key.pointerId) cancel(event.type);
    };
    const handleRelease = (event: MouseEvent | PointerEvent | TouchEvent) => release(event);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('keydown', handleEscape, { capture: true });
    window.addEventListener('lostpointercapture', handlePointerCancellation, { capture: true });
    window.addEventListener('mouseup', handleRelease, { capture: true });
    window.addEventListener('pointercancel', handlePointerCancellation, { capture: true });
    window.addEventListener('pointerup', handleRelease, { capture: true });
    window.addEventListener('touchend', handleRelease, { capture: true });
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('keydown', handleEscape, { capture: true });
      window.removeEventListener('lostpointercapture', handlePointerCancellation, { capture: true });
      window.removeEventListener('mouseup', handleRelease, { capture: true });
      window.removeEventListener('pointercancel', handlePointerCancellation, { capture: true });
      window.removeEventListener('pointerup', handleRelease, { capture: true });
      window.removeEventListener('touchend', handleRelease, { capture: true });
    };
  }, [cancel, controller, release]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      const session = sessionRef.current;
      const key = controller.cancel();
      if (session?.previewed === true && key !== null && isViewerMaskShapeKeyCurrent(key, currentRef.current.context)) {
        currentRef.current.onLiveMaskPreview?.(session.baselineContainer);
      }
      currentRef.current.onTouchInteractionChange(false);
      mountedRef.current = false;
      sessionRef.current = null;
    };
  }, [controller]);

  return { active, begin, cancel, commit, end, hover, preview, release, resetEpoch, select, sessionKey, transition };
};
