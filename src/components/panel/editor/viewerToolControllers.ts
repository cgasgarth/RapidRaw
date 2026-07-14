import type { ViewerGestureOwner } from './viewerInputResolver';

export interface ViewerToolPointerSample {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType: 'mouse' | 'pen' | 'touch';
  readonly pressure: number;
}

export type ViewerToolId =
  | 'brush'
  | 'crop'
  | 'focus-retouch'
  | 'mask'
  | 'pan'
  | 'retouch'
  | 'viewer-sampler'
  | 'white-balance';

export interface ViewerToolSessionKey {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly operationGeneration: number;
  readonly sourceRevision: string;
  readonly toolId: ViewerToolId;
}

export interface ViewerOverlayDescriptor {
  readonly ariaLabel: string;
  readonly geometryEpoch: number;
  readonly id: string;
  readonly pointerPolicy: 'capture' | 'none';
  readonly zOrder: 'active-tool' | 'tool-geometry' | 'viewer-hud';
}

export interface ViewerToolSession {
  readonly key: ViewerToolSessionKey;
  readonly lastPointerSample: ViewerToolPointerSample | null;
  readonly startedAtPointerId: number;
}

export type ViewerToolCommand =
  | { readonly kind: 'begin'; readonly owner: ViewerGestureOwner; readonly session: ViewerToolSession }
  | { readonly kind: 'update'; readonly pointerId: number; readonly session: ViewerToolSession }
  | { readonly kind: 'end' | 'cancel'; readonly pointerId: number; readonly session: ViewerToolSession };

export interface ViewerToolController {
  readonly id: ViewerToolId;
  begin(
    key: ViewerToolSessionKey,
    pointerId: number,
    owner: ViewerGestureOwner,
    sample?: ViewerToolPointerSample,
  ): ViewerToolCommand;
  overlays(session: ViewerToolSession): readonly ViewerOverlayDescriptor[];
  reduce(
    session: ViewerToolSession,
    event: {
      readonly kind: 'update' | 'end' | 'cancel';
      readonly pointerId: number;
      readonly sample?: ViewerToolPointerSample;
    },
  ): ViewerToolCommand | null;
}

const overlayZOrder = (id: ViewerToolId): ViewerOverlayDescriptor['zOrder'] =>
  id === 'pan' || id === 'viewer-sampler' ? 'viewer-hud' : id === 'crop' ? 'tool-geometry' : 'active-tool';

const createController = (id: ViewerToolId): ViewerToolController => ({
  id,
  begin: (key, pointerId, owner, sample) => ({
    kind: 'begin',
    owner,
    session: { key, lastPointerSample: sample ?? null, startedAtPointerId: pointerId },
  }),
  overlays: (session) => [
    {
      ariaLabel: `${session.key.toolId} interaction`,
      geometryEpoch: session.key.geometryEpoch,
      id: `${session.key.toolId}:${session.key.operationGeneration}`,
      pointerPolicy: session.key.toolId === 'pan' ? 'none' : 'capture',
      zOrder: overlayZOrder(session.key.toolId),
    },
  ],
  reduce: (session, event) => {
    if (event.pointerId !== session.startedAtPointerId) return null;
    const nextSession =
      event.kind === 'update' && event.sample !== undefined ? { ...session, lastPointerSample: event.sample } : session;
    return { kind: event.kind, pointerId: event.pointerId, session: nextSession };
  },
});

export const viewerToolControllers: Readonly<Record<ViewerToolId, ViewerToolController>> = {
  brush: createController('brush'),
  crop: createController('crop'),
  'focus-retouch': createController('focus-retouch'),
  mask: createController('mask'),
  pan: createController('pan'),
  retouch: createController('retouch'),
  'viewer-sampler': createController('viewer-sampler'),
  'white-balance': createController('white-balance'),
};

export const resolveViewerToolId = (tool: string): ViewerToolId => {
  if (tool === 'brush' || tool === 'crop' || tool === 'mask' || tool === 'retouch' || tool === 'white-balance')
    return tool;
  if (tool === 'object-prompt' || tool === 'parametric-mask' || tool === 'remove') return 'mask';
  if (tool === 'focus-retouch') return 'focus-retouch';
  if (tool === 'viewer-sampler') return 'viewer-sampler';
  return 'pan';
};

export interface ViewerToolSessionRegistry {
  active(): ViewerToolSession | null;
  begin(
    key: ViewerToolSessionKey,
    pointerId: number,
    owner: ViewerGestureOwner,
    sample?: ViewerToolPointerSample,
  ): ViewerToolCommand | null;
  invalidate(): ViewerToolCommand | null;
  reduce(event: {
    readonly kind: 'update' | 'end' | 'cancel';
    readonly pointerId: number;
    readonly sample?: ViewerToolPointerSample;
  }): ViewerToolCommand | null;
}

/** One owner and one cleanup path for every viewer gesture. */
export const createViewerToolSessionRegistry = (): ViewerToolSessionRegistry => {
  let session: ViewerToolSession | null = null;
  return {
    active: () => session,
    begin: (key, pointerId, owner, sample) => {
      if (session !== null) return null;
      const command = viewerToolControllers[key.toolId].begin(key, pointerId, owner, sample);
      session = command.session;
      return command;
    },
    invalidate: () => {
      if (session === null) return null;
      const command = { kind: 'cancel' as const, pointerId: session.startedAtPointerId, session };
      session = null;
      return command;
    },
    reduce: (event) => {
      if (session === null) return null;
      const command = viewerToolControllers[session.key.toolId].reduce(session, event);
      if (command?.kind === 'update') session = command.session;
      if (command !== null && (event.kind === 'end' || event.kind === 'cancel')) session = null;
      return command;
    },
  };
};

export const isViewerToolSessionCurrent = (expected: ViewerToolSessionKey, actual: ViewerToolSessionKey): boolean =>
  expected.imageSessionId === actual.imageSessionId &&
  expected.sourceRevision === actual.sourceRevision &&
  expected.geometryEpoch === actual.geometryEpoch &&
  expected.toolId === actual.toolId &&
  expected.operationGeneration === actual.operationGeneration;
