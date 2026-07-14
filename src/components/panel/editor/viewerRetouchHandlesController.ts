export type ViewerRetouchMode = 'clone' | 'heal' | 'remove';
export type ViewerRetouchHandle = 'sourcePoint' | 'targetPoint';
export type ViewerRetouchPointerType = 'mouse' | 'pen' | 'touch';

export interface ViewerRetouchPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewerRetouchCurrentContext {
  readonly active: boolean;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly layerId: string;
  readonly layerRevision: string;
  readonly mode: ViewerRetouchMode;
  readonly sourceRevision: string;
  readonly toolId: 'retouch-handles';
}

export interface ViewerRetouchSessionKey extends Omit<ViewerRetouchCurrentContext, 'active'> {
  readonly operationGeneration: number;
}

export interface ViewerRetouchPointer {
  readonly id: number;
  readonly pressure: number;
  readonly type: ViewerRetouchPointerType;
}

export type ViewerRetouchCommand =
  | {
      readonly handle: ViewerRetouchHandle;
      readonly key: ViewerRetouchSessionKey;
      readonly kind: 'update-clone-handle';
      readonly point: ViewerRetouchPoint;
    }
  | {
      readonly key: ViewerRetouchSessionKey;
      readonly kind: 'update-remove-target';
      readonly point: ViewerRetouchPoint;
    };

export interface ViewerRetouchOverlayOverride {
  readonly handle: ViewerRetouchHandle;
  readonly key: ViewerRetouchSessionKey;
  readonly point: ViewerRetouchPoint;
  readonly pointer: ViewerRetouchPointer;
}

interface ActiveSession extends ViewerRetouchOverlayOverride {}

export interface ViewerRetouchHandlesController {
  begin(
    context: ViewerRetouchCurrentContext,
    handle: ViewerRetouchHandle,
    pointer: ViewerRetouchPointer,
    point: ViewerRetouchPoint,
  ): boolean;
  cancel(): void;
  end(
    context: ViewerRetouchCurrentContext,
    pointer: ViewerRetouchPointer,
    point: ViewerRetouchPoint,
  ): ViewerRetouchCommand | null;
  fail(key: ViewerRetouchSessionKey, context: ViewerRetouchCurrentContext): boolean;
  move(pointer: ViewerRetouchPointer, point: ViewerRetouchPoint): boolean;
  overlayOverride(): ViewerRetouchOverlayOverride | null;
  place(
    context: ViewerRetouchCurrentContext,
    sourceModifier: boolean,
    pointer: ViewerRetouchPointer,
    point: ViewerRetouchPoint,
  ): ViewerRetouchCommand | null;
  receive(key: ViewerRetouchSessionKey, context: ViewerRetouchCurrentContext): boolean;
  synchronize(context: ViewerRetouchCurrentContext): void;
}

export const isViewerRetouchSessionCurrent = (
  key: ViewerRetouchSessionKey,
  context: ViewerRetouchCurrentContext,
): boolean =>
  context.active &&
  key.geometryEpoch === context.geometryEpoch &&
  key.imageSessionId === context.imageSessionId &&
  key.layerId === context.layerId &&
  key.layerRevision === context.layerRevision &&
  key.mode === context.mode &&
  key.sourceRevision === context.sourceRevision &&
  key.toolId === context.toolId;

const sameContext = (left: ViewerRetouchCurrentContext, right: ViewerRetouchCurrentContext): boolean =>
  left.active === right.active &&
  left.geometryEpoch === right.geometryEpoch &&
  left.imageSessionId === right.imageSessionId &&
  left.layerId === right.layerId &&
  left.layerRevision === right.layerRevision &&
  left.mode === right.mode &&
  left.sourceRevision === right.sourceRevision &&
  left.toolId === right.toolId;

const keyFrom = (context: ViewerRetouchCurrentContext, operationGeneration: number): ViewerRetouchSessionKey => ({
  geometryEpoch: context.geometryEpoch,
  imageSessionId: context.imageSessionId,
  layerId: context.layerId,
  layerRevision: context.layerRevision,
  mode: context.mode,
  operationGeneration,
  sourceRevision: context.sourceRevision,
  toolId: context.toolId,
});

/** Exact-session authority for clone, heal, and remove placement handles. */
export const createViewerRetouchHandlesController = (): ViewerRetouchHandlesController => {
  let active: ActiveSession | null = null;
  let current: ViewerRetouchCurrentContext | null = null;
  let generation = 0;
  let pending: ViewerRetouchSessionKey | null = null;

  const synchronize = (context: ViewerRetouchCurrentContext): void => {
    if (current !== null && sameContext(current, context)) return;
    active = null;
    pending = null;
    current = context;
  };
  const command = (session: ActiveSession): ViewerRetouchCommand =>
    session.key.mode === 'remove'
      ? { key: session.key, kind: 'update-remove-target', point: session.point }
      : { handle: session.handle, key: session.key, kind: 'update-clone-handle', point: session.point };
  const settle = (key: ViewerRetouchSessionKey, context: ViewerRetouchCurrentContext): boolean => {
    if (pending?.operationGeneration !== key.operationGeneration) return false;
    const accepted = isViewerRetouchSessionCurrent(key, context);
    pending = null;
    return accepted;
  };

  return {
    begin: (context, handle, pointer, point) => {
      synchronize(context);
      if (!context.active || active !== null || pending !== null) return false;
      generation += 1;
      active = {
        handle: context.mode === 'remove' ? 'targetPoint' : handle,
        key: keyFrom(context, generation),
        point,
        pointer,
      };
      return true;
    },
    cancel: () => {
      active = null;
      pending = null;
    },
    end: (context, pointer, point) => {
      synchronize(context);
      if (active === null || active.pointer.id !== pointer.id) return null;
      const completed = { ...active, point, pointer };
      active = null;
      pending = completed.key;
      return command(completed);
    },
    fail: settle,
    move: (pointer, point) => {
      if (active === null || active.pointer.id !== pointer.id) return false;
      active = { ...active, point, pointer };
      return true;
    },
    overlayOverride: () => active,
    place: (context, sourceModifier, pointer, point) => {
      const handle = context.mode === 'remove' || !sourceModifier ? 'targetPoint' : 'sourcePoint';
      if (!active && !pending && context.active) {
        generation += 1;
        const session: ActiveSession = {
          handle,
          key: keyFrom(context, generation),
          point,
          pointer,
        };
        pending = session.key;
        return command(session);
      }
      return null;
    },
    receive: settle,
    synchronize,
  };
};
