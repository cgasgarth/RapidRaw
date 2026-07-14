import type { FocusRetouchStrokeRequest } from './focusRetouchCommandService';

export interface ViewerFocusRetouchCurrentContext {
  readonly active: boolean;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly packagePath: string;
  readonly revisionId: string | null;
  readonly sourceRevision: string;
  readonly toolId: 'focus-retouch';
}

export interface ViewerFocusRetouchSessionKey extends Omit<ViewerFocusRetouchCurrentContext, 'active' | 'revisionId'> {
  readonly operationGeneration: number;
  readonly revisionId: string | null;
}

export interface ViewerFocusRetouchSettings {
  readonly erase: boolean;
  readonly hardnessPercent: number;
  readonly radiusPx: number;
  readonly selectedSource: number;
}

export interface ViewerFocusRetouchOverlayDescriptor {
  readonly geometryEpoch: number;
  readonly id: string;
  readonly pointsFixed1256Px: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly pointerPolicy: 'none';
  readonly zOrder: 'active-tool';
}

export type ViewerFocusRetouchCommand = {
  readonly key: ViewerFocusRetouchSessionKey;
  readonly kind: 'apply-stroke';
  readonly request: FocusRetouchStrokeRequest;
};

interface ActiveSession {
  readonly key: ViewerFocusRetouchSessionKey;
  readonly pointerId: number;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly settings: ViewerFocusRetouchSettings;
}

export interface ViewerFocusRetouchInteractionController {
  begin(
    context: ViewerFocusRetouchCurrentContext,
    pointerId: number,
    point: { readonly x: number; readonly y: number },
    settings: ViewerFocusRetouchSettings,
  ): boolean;
  cancel(): void;
  end(context: ViewerFocusRetouchCurrentContext, pointerId: number): ViewerFocusRetouchCommand | null;
  fail(key: ViewerFocusRetouchSessionKey, context: ViewerFocusRetouchCurrentContext): boolean;
  move(pointerId: number, point: { readonly x: number; readonly y: number }): boolean;
  overlays(): readonly ViewerFocusRetouchOverlayDescriptor[];
  receive(key: ViewerFocusRetouchSessionKey, context: ViewerFocusRetouchCurrentContext): boolean;
  synchronize(context: ViewerFocusRetouchCurrentContext): void;
}

export const isViewerFocusRetouchSessionCurrent = (
  key: ViewerFocusRetouchSessionKey,
  context: ViewerFocusRetouchCurrentContext,
): boolean =>
  context.active &&
  key.geometryEpoch === context.geometryEpoch &&
  key.imageSessionId === context.imageSessionId &&
  key.packagePath === context.packagePath &&
  key.revisionId === context.revisionId &&
  key.sourceRevision === context.sourceRevision &&
  key.toolId === context.toolId;

/** Keyed authority for active and in-flight focus-retouch strokes. */
export const createViewerFocusRetouchInteractionController = (): ViewerFocusRetouchInteractionController => {
  let active: ActiveSession | null = null;
  let generation = 0;
  let pending: ViewerFocusRetouchSessionKey | null = null;
  let currentContext: ViewerFocusRetouchCurrentContext | null = null;

  const synchronize = (context: ViewerFocusRetouchCurrentContext): void => {
    if (
      currentContext !== null &&
      currentContext.active === context.active &&
      currentContext.geometryEpoch === context.geometryEpoch &&
      currentContext.imageSessionId === context.imageSessionId &&
      currentContext.packagePath === context.packagePath &&
      currentContext.revisionId === context.revisionId &&
      currentContext.sourceRevision === context.sourceRevision
    ) {
      return;
    }
    active = null;
    pending = null;
    currentContext = context;
  };

  const settle = (key: ViewerFocusRetouchSessionKey, context: ViewerFocusRetouchCurrentContext): boolean => {
    if (pending === null || pending.operationGeneration !== key.operationGeneration) return false;
    const accepted = isViewerFocusRetouchSessionCurrent(key, context);
    pending = null;
    return accepted;
  };

  return {
    begin: (context, pointerId, point, settings) => {
      synchronize(context);
      if (!context.active || active !== null || pending !== null) return false;
      generation += 1;
      active = {
        key: {
          geometryEpoch: context.geometryEpoch,
          imageSessionId: context.imageSessionId,
          operationGeneration: generation,
          packagePath: context.packagePath,
          revisionId: context.revisionId,
          sourceRevision: context.sourceRevision,
          toolId: context.toolId,
        },
        pointerId,
        points: [point],
        settings,
      };
      return true;
    },
    cancel: () => {
      active = null;
      pending = null;
    },
    end: (context, pointerId) => {
      synchronize(context);
      if (active === null || active.pointerId !== pointerId || active.points.length === 0) return null;
      const completed = active;
      active = null;
      pending = completed.key;
      return {
        key: completed.key,
        kind: 'apply-stroke',
        request: {
          expectedRevisionId: completed.key.revisionId,
          packagePath: completed.key.packagePath,
          stroke: {
            hardnessU16: Math.round((completed.settings.hardnessPercent * 65535) / 100),
            pointsFixed1256Px: completed.points,
            radiusFixed1256Px: Math.round(completed.settings.radiusPx * 256),
            sourceIndex: completed.settings.erase ? null : completed.settings.selectedSource,
            strokeId: `focus-retouch:${completed.key.imageSessionId}:${String(completed.key.operationGeneration)}`,
          },
        },
      };
    },
    fail: settle,
    move: (pointerId, point) => {
      if (active === null || active.pointerId !== pointerId) return false;
      active = { ...active, points: [...active.points, point] };
      return true;
    },
    overlays: () =>
      active === null
        ? []
        : [
            {
              geometryEpoch: active.key.geometryEpoch,
              id: `focus-retouch:${active.key.operationGeneration}`,
              pointsFixed1256Px: active.points,
              pointerPolicy: 'none',
              zOrder: 'active-tool',
            },
          ],
    receive: settle,
    synchronize,
  };
};
