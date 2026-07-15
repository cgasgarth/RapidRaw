export type ViewerInitialMaskDrawTool = 'linear' | 'radial';
export type ViewerInitialMaskDrawPointerType = 'mouse' | 'pen' | 'touch';

export interface ViewerInitialMaskDrawPoint {
  readonly imagePoint: { readonly x: number; readonly y: number };
  readonly viewPoint: { readonly x: number; readonly y: number };
}

export interface ViewerInitialMaskDrawSample extends ViewerInitialMaskDrawPoint {
  readonly pointerId: number;
  readonly pointerType: ViewerInitialMaskDrawPointerType;
}

export interface ViewerInitialMaskDrawCurrentContext {
  readonly active: boolean;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly maskId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly tool: ViewerInitialMaskDrawTool;
}

export interface ViewerInitialMaskDrawSessionKey extends ViewerInitialMaskDrawCurrentContext {
  readonly active: true;
  readonly operationGeneration: number;
}

export interface ViewerInitialMaskDrawSettings {
  readonly baselineParameters: Readonly<Record<string, unknown>>;
  readonly imageSize: { readonly height: number; readonly width: number };
}

export interface ViewerInitialMaskDrawOverlayDescriptor {
  readonly geometryEpoch: number;
  readonly id: string;
  readonly input: { readonly pointerId: number; readonly pointerType: ViewerInitialMaskDrawPointerType };
  readonly maskId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly pointerPolicy: 'none';
  readonly sessionKey: ViewerInitialMaskDrawSessionKey;
  readonly zOrder: 'active-tool';
}

export interface ViewerInitialMaskDrawCommand {
  readonly key: ViewerInitialMaskDrawSessionKey;
  readonly kind: 'commit-initial-mask';
  readonly maskId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

interface ActiveInitialMaskDraw {
  readonly key: ViewerInitialMaskDrawSessionKey;
  readonly last: ViewerInitialMaskDrawPoint;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly pointerId: number;
  readonly pointerType: ViewerInitialMaskDrawPointerType;
  readonly settings: ViewerInitialMaskDrawSettings;
  readonly start: ViewerInitialMaskDrawPoint;
}

const DRAW_THRESHOLD_CSS_PIXELS = 15;

const sameContext = (key: ViewerInitialMaskDrawSessionKey, context: ViewerInitialMaskDrawCurrentContext): boolean =>
  context.active &&
  key.geometryEpoch === context.geometryEpoch &&
  key.imageSessionId === context.imageSessionId &&
  key.maskId === context.maskId &&
  key.sourceIdentity === context.sourceIdentity &&
  key.sourceRevision === context.sourceRevision &&
  key.tool === context.tool;

const pointerMatches = (
  active: ActiveInitialMaskDraw,
  pointerId: number,
  pointerType: ViewerInitialMaskDrawPointerType,
): boolean => active.pointerId === pointerId && active.pointerType === pointerType;

const samePoint = (left: ViewerInitialMaskDrawPoint, right: ViewerInitialMaskDrawPoint): boolean =>
  left.imagePoint.x === right.imagePoint.x &&
  left.imagePoint.y === right.imagePoint.y &&
  left.viewPoint.x === right.viewPoint.x &&
  left.viewPoint.y === right.viewPoint.y;

const isFinitePoint = (point: ViewerInitialMaskDrawPoint): boolean =>
  Number.isFinite(point.imagePoint.x) &&
  Number.isFinite(point.imagePoint.y) &&
  Number.isFinite(point.viewPoint.x) &&
  Number.isFinite(point.viewPoint.y);

const isValidSettings = (settings: ViewerInitialMaskDrawSettings): boolean =>
  Number.isFinite(settings.imageSize.height) &&
  Number.isFinite(settings.imageSize.width) &&
  settings.imageSize.height > 0 &&
  settings.imageSize.width > 0;

const initialParameters = (
  tool: ViewerInitialMaskDrawTool,
  baseline: Readonly<Record<string, unknown>>,
  start: ViewerInitialMaskDrawPoint,
): Readonly<Record<string, unknown>> =>
  tool === 'radial'
    ? {
        ...baseline,
        centerX: start.imagePoint.x,
        centerY: start.imagePoint.y,
        radiusX: 0,
        radiusY: 0,
        rotation: 0,
      }
    : {
        ...baseline,
        endX: start.imagePoint.x,
        endY: start.imagePoint.y,
        range: 0,
        startX: start.imagePoint.x,
        startY: start.imagePoint.y,
      };

const movedParameters = (
  active: ActiveInitialMaskDraw,
  point: ViewerInitialMaskDrawPoint,
): Readonly<Record<string, unknown>> => {
  const viewDistance = Math.hypot(
    point.viewPoint.x - active.start.viewPoint.x,
    point.viewPoint.y - active.start.viewPoint.y,
  );
  if (viewDistance < DRAW_THRESHOLD_CSS_PIXELS) return active.parameters;

  const dx = point.imagePoint.x - active.start.imagePoint.x;
  const dy = point.imagePoint.y - active.start.imagePoint.y;
  if (active.key.tool === 'radial') {
    return {
      ...active.parameters,
      radiusX: Math.max(1, Math.abs(dx)),
      radiusY: Math.max(1, Math.abs(dy)),
    };
  }

  const range = Math.max(1, Math.hypot(dx, dy));
  const perpendicularX = -dy / range;
  const perpendicularY = dx / range;
  const handleDistance = Math.min(active.settings.imageSize.width, active.settings.imageSize.height) * 0.2;
  return {
    ...active.parameters,
    endX: active.start.imagePoint.x - perpendicularX * handleDistance,
    endY: active.start.imagePoint.y - perpendicularY * handleDistance,
    range,
    startX: active.start.imagePoint.x + perpendicularX * handleDistance,
    startY: active.start.imagePoint.y + perpendicularY * handleDistance,
  };
};

const numericParameter = (parameters: Readonly<Record<string, unknown>>, name: string): number => {
  const value = parameters[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const committedParameters = (active: ActiveInitialMaskDraw): Readonly<Record<string, unknown>> => {
  const parameters = { ...active.parameters };
  delete parameters['isInitialDraw'];
  if (
    active.key.tool === 'radial' &&
    numericParameter(parameters, 'radiusX') < 10 &&
    numericParameter(parameters, 'radiusY') < 10
  ) {
    parameters['radiusX'] = 100;
    parameters['radiusY'] = 100;
  } else if (active.key.tool === 'linear' && numericParameter(parameters, 'range') < 10) {
    const handleDistance = Math.min(active.settings.imageSize.width, active.settings.imageSize.height) * 0.2;
    parameters['startX'] = active.start.imagePoint.x + handleDistance;
    parameters['startY'] = active.start.imagePoint.y;
    parameters['endX'] = active.start.imagePoint.x - handleDistance;
    parameters['endY'] = active.start.imagePoint.y;
    parameters['range'] = 100;
  }
  return parameters;
};

const overlayFor = (active: ActiveInitialMaskDraw): ViewerInitialMaskDrawOverlayDescriptor => ({
  geometryEpoch: active.key.geometryEpoch,
  id: `initial-mask:${active.key.imageSessionId}:${String(active.key.operationGeneration)}`,
  input: { pointerId: active.pointerId, pointerType: active.pointerType },
  maskId: active.key.maskId,
  parameters: active.parameters,
  pointerPolicy: 'none',
  sessionKey: active.key,
  zOrder: 'active-tool',
});

export interface ViewerInitialMaskDrawInteractionController {
  begin(
    context: ViewerInitialMaskDrawCurrentContext,
    sample: ViewerInitialMaskDrawSample,
    settings: ViewerInitialMaskDrawSettings,
  ): boolean;
  cancel(): void;
  end(
    context: ViewerInitialMaskDrawCurrentContext,
    pointerId: number,
    pointerType: ViewerInitialMaskDrawPointerType,
  ): readonly ViewerInitialMaskDrawCommand[];
  isActive(): boolean;
  move(context: ViewerInitialMaskDrawCurrentContext, sample: ViewerInitialMaskDrawSample): boolean;
  overlays(): readonly ViewerInitialMaskDrawOverlayDescriptor[];
  synchronize(context: ViewerInitialMaskDrawCurrentContext): boolean;
}

/** Framework-free authority for one initial Radial or Linear mask gesture. */
export const createViewerInitialMaskDrawInteractionController = (): ViewerInitialMaskDrawInteractionController => {
  let active: ActiveInitialMaskDraw | null = null;
  let operationGeneration = 0;

  const synchronize = (context: ViewerInitialMaskDrawCurrentContext): boolean => {
    if (active === null || sameContext(active.key, context)) return false;
    active = null;
    return true;
  };

  return {
    begin: (context, sample, settings) => {
      synchronize(context);
      if (!context.active || active !== null || !isFinitePoint(sample) || !isValidSettings(settings)) return false;
      operationGeneration += 1;
      active = {
        key: { ...context, active: true, operationGeneration },
        last: sample,
        parameters: initialParameters(context.tool, settings.baselineParameters, sample),
        pointerId: sample.pointerId,
        pointerType: sample.pointerType,
        settings,
        start: sample,
      };
      return true;
    },
    cancel: () => {
      active = null;
    },
    end: (context, pointerId, pointerType) => {
      if (synchronize(context) || active === null || !pointerMatches(active, pointerId, pointerType)) return [];
      const completed = active;
      active = null;
      return [
        {
          key: completed.key,
          kind: 'commit-initial-mask',
          maskId: completed.key.maskId,
          parameters: committedParameters(completed),
        },
      ];
    },
    isActive: () => active !== null,
    move: (context, sample) => {
      if (
        synchronize(context) ||
        active === null ||
        !pointerMatches(active, sample.pointerId, sample.pointerType) ||
        !isFinitePoint(sample) ||
        samePoint(active.last, sample)
      )
        return false;
      active = { ...active, last: sample, parameters: movedParameters(active, sample) };
      return true;
    },
    overlays: () => (active === null ? [] : [overlayFor(active)]),
    synchronize,
  };
};
