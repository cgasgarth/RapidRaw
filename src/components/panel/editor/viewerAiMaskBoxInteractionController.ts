export type ViewerAiMaskBoxTool = 'ai-subject' | 'quick-eraser';
export type ViewerAiMaskBoxPointerType = 'mouse' | 'pen' | 'touch';

export interface ViewerAiMaskBoxPoint {
  readonly imagePoint: { readonly x: number; readonly y: number };
  readonly viewPoint: { readonly x: number; readonly y: number };
}

export interface ViewerAiMaskBoxSample extends ViewerAiMaskBoxPoint {
  readonly pointerId: number;
  readonly pointerType: ViewerAiMaskBoxPointerType;
}

export interface ViewerAiMaskBoxCurrentContext {
  readonly active: boolean;
  readonly containerFamily: 'aiPatches' | 'masks';
  readonly containerId: string;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly maskId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly tool: ViewerAiMaskBoxTool;
}

export interface ViewerAiMaskBoxSessionKey extends ViewerAiMaskBoxCurrentContext {
  readonly active: true;
  readonly operationGeneration: number;
}

export interface ViewerAiMaskBoxOverlayDescriptor {
  readonly end: ViewerAiMaskBoxPoint;
  readonly geometryEpoch: number;
  readonly id: string;
  readonly input: { readonly pointerId: number; readonly pointerType: ViewerAiMaskBoxPointerType };
  readonly maskId: string;
  readonly pointerPolicy: 'none';
  readonly sessionKey: ViewerAiMaskBoxSessionKey;
  readonly start: ViewerAiMaskBoxPoint;
  readonly zOrder: 'active-tool';
}

export interface ViewerAiMaskBoxCommand {
  readonly endPoint: { readonly x: number; readonly y: number };
  readonly key: ViewerAiMaskBoxSessionKey;
  readonly kind: 'commit-ai-mask-box';
  readonly maskId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly startPoint: { readonly x: number; readonly y: number };
}

interface ActiveSession {
  readonly baselineParameters: Readonly<Record<string, unknown>>;
  readonly end: ViewerAiMaskBoxPoint;
  readonly key: ViewerAiMaskBoxSessionKey;
  readonly pointerId: number;
  readonly pointerType: ViewerAiMaskBoxPointerType;
  readonly start: ViewerAiMaskBoxPoint;
}

const CLICK_THRESHOLD_CSS_PIXELS = 5;

const sameContext = (key: ViewerAiMaskBoxSessionKey, context: ViewerAiMaskBoxCurrentContext): boolean =>
  context.active &&
  key.containerFamily === context.containerFamily &&
  key.containerId === context.containerId &&
  key.geometryEpoch === context.geometryEpoch &&
  key.imageSessionId === context.imageSessionId &&
  key.maskId === context.maskId &&
  key.sourceIdentity === context.sourceIdentity &&
  key.sourceRevision === context.sourceRevision &&
  key.tool === context.tool;

const isViewerAiMaskBoxKeyCurrent = (key: ViewerAiMaskBoxSessionKey, context: ViewerAiMaskBoxCurrentContext): boolean =>
  sameContext(key, context);

const finitePoint = (point: ViewerAiMaskBoxPoint): boolean =>
  Number.isFinite(point.imagePoint.x) &&
  Number.isFinite(point.imagePoint.y) &&
  Number.isFinite(point.viewPoint.x) &&
  Number.isFinite(point.viewPoint.y);

const samePoint = (left: ViewerAiMaskBoxPoint, right: ViewerAiMaskBoxPoint): boolean =>
  left.imagePoint.x === right.imagePoint.x &&
  left.imagePoint.y === right.imagePoint.y &&
  left.viewPoint.x === right.viewPoint.x &&
  left.viewPoint.y === right.viewPoint.y;

const pointerMatches = (active: ActiveSession, sample: Pick<ViewerAiMaskBoxSample, 'pointerId' | 'pointerType'>) =>
  active.pointerId === sample.pointerId && active.pointerType === sample.pointerType;

const overlayFor = (active: ActiveSession): ViewerAiMaskBoxOverlayDescriptor => ({
  end: active.end,
  geometryEpoch: active.key.geometryEpoch,
  id: `ai-mask-box:${active.key.imageSessionId}:${String(active.key.operationGeneration)}`,
  input: { pointerId: active.pointerId, pointerType: active.pointerType },
  maskId: active.key.maskId,
  pointerPolicy: 'none',
  sessionKey: active.key,
  start: active.start,
  zOrder: 'active-tool',
});

export interface ViewerAiMaskBoxInteractionController {
  begin(
    context: ViewerAiMaskBoxCurrentContext,
    sample: ViewerAiMaskBoxSample,
    baselineParameters: Readonly<Record<string, unknown>>,
  ): boolean;
  cancel(): void;
  end(
    context: ViewerAiMaskBoxCurrentContext,
    pointerId: number,
    pointerType: ViewerAiMaskBoxPointerType,
    sample?: ViewerAiMaskBoxSample,
  ): readonly ViewerAiMaskBoxCommand[];
  isActive(): boolean;
  move(context: ViewerAiMaskBoxCurrentContext, sample: ViewerAiMaskBoxSample): boolean;
  overlays(): readonly ViewerAiMaskBoxOverlayDescriptor[];
  synchronize(context: ViewerAiMaskBoxCurrentContext): boolean;
}

/** Framework-free authority for one source-bound AI Subject or Quick Erase box gesture. */
export const createViewerAiMaskBoxInteractionController = (): ViewerAiMaskBoxInteractionController => {
  let active: ActiveSession | null = null;
  let operationGeneration = 0;

  const synchronize = (context: ViewerAiMaskBoxCurrentContext): boolean => {
    if (active === null || sameContext(active.key, context)) return false;
    active = null;
    return true;
  };

  return {
    begin: (context, sample, baselineParameters) => {
      synchronize(context);
      if (!context.active || active !== null || !finitePoint(sample)) return false;
      operationGeneration += 1;
      active = {
        baselineParameters,
        end: sample,
        key: { ...context, active: true, operationGeneration },
        pointerId: sample.pointerId,
        pointerType: sample.pointerType,
        start: sample,
      };
      return true;
    },
    cancel: () => {
      active = null;
    },
    end: (context, pointerId, pointerType, sample) => {
      if (
        synchronize(context) ||
        active === null ||
        !pointerMatches(active, { pointerId, pointerType }) ||
        (sample !== undefined && (!pointerMatches(active, sample) || !finitePoint(sample)))
      )
        return [];
      const completed = sample === undefined || samePoint(active.end, sample) ? active : { ...active, end: sample };
      active = null;
      const distance = Math.hypot(
        completed.end.viewPoint.x - completed.start.viewPoint.x,
        completed.end.viewPoint.y - completed.start.viewPoint.y,
      );
      const endPoint = distance < CLICK_THRESHOLD_CSS_PIXELS ? completed.start.imagePoint : completed.end.imagePoint;
      return [
        {
          endPoint,
          key: completed.key,
          kind: 'commit-ai-mask-box',
          maskId: completed.key.maskId,
          parameters: {
            ...completed.baselineParameters,
            endX: endPoint.x,
            endY: endPoint.y,
            startX: completed.start.imagePoint.x,
            startY: completed.start.imagePoint.y,
          },
          startPoint: completed.start.imagePoint,
        },
      ];
    },
    isActive: () => active !== null,
    move: (context, sample) => {
      if (
        synchronize(context) ||
        active === null ||
        !pointerMatches(active, sample) ||
        !finitePoint(sample) ||
        samePoint(active.end, sample)
      )
        return false;
      active = { ...active, end: sample };
      return true;
    },
    overlays: () => (active === null ? [] : [overlayFor(active)]),
    synchronize,
  };
};
