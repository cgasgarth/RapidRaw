import type { AiPatch, MaskContainer } from '../../../utils/adjustments';
import type { SubMask } from '../right/layers/Masks';
import type { ViewerPointerType } from './viewerPointerEvents';

type ViewerMaskShapeContainer = AiPatch | MaskContainer;
export type ViewerMaskShapeContainerKind = 'aiPatches' | 'masks';

export interface ViewerMaskShapeCurrentContext {
  readonly active: boolean;
  readonly containerId: string;
  readonly containerKind: ViewerMaskShapeContainerKind;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export interface ViewerMaskShapeTarget {
  readonly containerId: string;
  readonly containerKind: ViewerMaskShapeContainerKind;
  readonly subMaskId: string;
}

export interface ViewerMaskShapeSessionKey extends ViewerMaskShapeTarget {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly operationId: string;
  readonly pointerId: number;
  readonly pointerType: ViewerPointerType;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export interface ViewerMaskShapeOverlayDescriptor {
  readonly key: ViewerMaskShapeSessionKey;
  readonly patch: Partial<SubMask>;
  readonly pointerPolicy: 'capture';
  readonly zOrder: 'tool-geometry';
}

export interface ViewerMaskShapeCommand {
  readonly key: ViewerMaskShapeSessionKey;
  readonly patch: Partial<SubMask>;
  readonly subMaskId: string;
  readonly type: 'commit-mask-shape';
}

interface ActiveSession {
  readonly key: ViewerMaskShapeSessionKey;
  overlay: ViewerMaskShapeOverlayDescriptor | null;
}

export const isViewerMaskShapeKeyCurrent = (
  key: ViewerMaskShapeSessionKey,
  current: ViewerMaskShapeCurrentContext,
): boolean =>
  current.active &&
  current.containerId === key.containerId &&
  current.containerKind === key.containerKind &&
  current.geometryEpoch === key.geometryEpoch &&
  current.imageSessionId === key.imageSessionId &&
  current.sourceIdentity === key.sourceIdentity &&
  current.sourceRevision === key.sourceRevision;

export interface ViewerMaskShapeInteractionController {
  begin(
    current: ViewerMaskShapeCurrentContext,
    target: ViewerMaskShapeTarget,
    pointer: { readonly pointerId: number; readonly pointerType: ViewerPointerType },
    operationId: string,
  ): ViewerMaskShapeSessionKey | null;
  cancel(): ViewerMaskShapeSessionKey | null;
  commit(
    current: ViewerMaskShapeCurrentContext,
    subMaskId: string,
    patch: Partial<SubMask>,
  ): ViewerMaskShapeCommand | null;
  end(current: ViewerMaskShapeCurrentContext): ViewerMaskShapeSessionKey | null;
  isActive(): boolean;
  overlays(): readonly ViewerMaskShapeOverlayDescriptor[];
  preview(
    current: ViewerMaskShapeCurrentContext,
    subMaskId: string,
    patch: Partial<SubMask>,
  ): ViewerMaskShapeOverlayDescriptor | null;
  synchronize(current: ViewerMaskShapeCurrentContext): ViewerMaskShapeSessionKey | null;
}

export const createViewerMaskShapeInteractionController = (): ViewerMaskShapeInteractionController => {
  let active: ActiveSession | null = null;

  const cancel = (): ViewerMaskShapeSessionKey | null => {
    const key = active?.key ?? null;
    active = null;
    return key;
  };
  const validSession = (current: ViewerMaskShapeCurrentContext, subMaskId: string): ActiveSession | null => {
    if (active === null || active.key.subMaskId !== subMaskId || !isViewerMaskShapeKeyCurrent(active.key, current)) {
      return null;
    }
    return active;
  };

  return {
    begin: (current, target, pointer, operationId) => {
      if (
        !current.active ||
        target.containerId !== current.containerId ||
        target.containerKind !== current.containerKind ||
        active !== null
      ) {
        return null;
      }
      const key: ViewerMaskShapeSessionKey = {
        ...target,
        geometryEpoch: current.geometryEpoch,
        imageSessionId: current.imageSessionId,
        operationId,
        pointerId: pointer.pointerId,
        pointerType: pointer.pointerType,
        sourceIdentity: current.sourceIdentity,
        sourceRevision: current.sourceRevision,
      };
      active = { key, overlay: null };
      return key;
    },
    cancel,
    commit: (current, subMaskId, patch) => {
      const session = validSession(current, subMaskId);
      return session === null
        ? null
        : { key: session.key, patch: structuredClone(patch), subMaskId, type: 'commit-mask-shape' };
    },
    end: (current) => {
      if (active === null || !isViewerMaskShapeKeyCurrent(active.key, current)) return cancel();
      return cancel();
    },
    isActive: () => active !== null,
    overlays: () => (active?.overlay === null || active === null ? [] : [active.overlay]),
    preview: (current, subMaskId, patch) => {
      const session = validSession(current, subMaskId);
      if (session === null) return null;
      session.overlay = {
        key: session.key,
        patch: structuredClone(patch),
        pointerPolicy: 'capture',
        zOrder: 'tool-geometry',
      };
      return session.overlay;
    },
    synchronize: (current) => (active !== null && !isViewerMaskShapeKeyCurrent(active.key, current) ? cancel() : null),
  };
};
