export type ViewerBrushTool = 'brush' | 'eraser';
export type ViewerBrushPointerType = 'mouse' | 'pen' | 'touch';

export interface ViewerBrushPoint {
  readonly pressure?: number;
  readonly x: number;
  readonly y: number;
}

export interface ViewerBrushLine {
  readonly brushSize: number;
  readonly feather: number;
  readonly flow?: number;
  readonly points: Array<ViewerBrushPoint>;
  readonly tool: ViewerBrushTool;
}

export interface ViewerBrushSessionIdentity {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly maskId: string;
  readonly sourceRevision: string;
  readonly toolId: 'brush';
}

export interface ViewerBrushSessionKey extends ViewerBrushSessionIdentity {
  readonly operationGeneration: number;
}

export interface ViewerBrushCurrentContext extends ViewerBrushSessionIdentity {
  readonly active: boolean;
}

export interface ViewerBrushPointerSample {
  readonly altKey: boolean;
  readonly imagePoint: ViewerBrushPoint;
  readonly pointerId: number;
  readonly pointerType: ViewerBrushPointerType;
  readonly shiftKey: boolean;
  readonly viewPoint: ViewerBrushPoint;
}

export interface ViewerBrushSettings {
  readonly canonicalTool: ViewerBrushTool;
  readonly feather: number;
  readonly flow?: number;
  readonly imageSpaceSize: number;
}

export interface ViewerBrushOverlayDescriptor {
  readonly geometryEpoch: number;
  readonly id: string;
  readonly imageLine: ViewerBrushLine;
  readonly pointerPolicy: 'none';
  readonly zOrder: 'active-tool';
}

export type ViewerBrushCommand =
  | { readonly kind: 'begin'; readonly key: ViewerBrushSessionKey }
  | { readonly kind: 'update'; readonly key: ViewerBrushSessionKey }
  | { readonly kind: 'commit'; readonly key: ViewerBrushSessionKey; readonly line: ViewerBrushLine }
  | { readonly kind: 'cancel'; readonly key: ViewerBrushSessionKey; readonly reason: ViewerBrushCancelReason };

export type ViewerBrushCancelReason =
  | 'blur'
  | 'escape'
  | 'lostpointercapture'
  | 'pointercancel'
  | 'session-invalidated'
  | 'unmount';

interface ViewerBrushSession {
  readonly key: ViewerBrushSessionKey;
  readonly pointerId: number;
  readonly settings: ViewerBrushSettings;
  readonly samples: readonly ViewerBrushPointerSample[];
}

export interface ViewerBrushInteractionController {
  begin(
    context: ViewerBrushCurrentContext,
    sample: ViewerBrushPointerSample,
    settings: ViewerBrushSettings,
  ): readonly ViewerBrushCommand[];
  cancel(reason: ViewerBrushCancelReason): readonly ViewerBrushCommand[];
  end(context: ViewerBrushCurrentContext, sample?: ViewerBrushPointerSample): readonly ViewerBrushCommand[];
  move(context: ViewerBrushCurrentContext, sample: ViewerBrushPointerSample): readonly ViewerBrushCommand[];
  overlays(): readonly ViewerBrushOverlayDescriptor[];
  synchronize(context: ViewerBrushCurrentContext): readonly ViewerBrushCommand[];
}

const sameIdentity = (key: ViewerBrushSessionIdentity, context: ViewerBrushCurrentContext): boolean =>
  context.active &&
  key.geometryEpoch === context.geometryEpoch &&
  key.imageSessionId === context.imageSessionId &&
  key.maskId === context.maskId &&
  key.sourceRevision === context.sourceRevision &&
  key.toolId === context.toolId;

const effectiveTool = (canonicalTool: ViewerBrushTool, altKey: boolean): ViewerBrushTool =>
  altKey ? (canonicalTool === 'brush' ? 'eraser' : 'brush') : canonicalTool;

const lineFromSamples = (
  samples: readonly ViewerBrushPointerSample[],
  settings: ViewerBrushSettings,
): ViewerBrushLine => ({
  brushSize: settings.imageSpaceSize,
  feather: settings.feather,
  ...(settings.flow === undefined ? {} : { flow: settings.flow }),
  points: samples.map(({ imagePoint }) => imagePoint),
  tool: effectiveTool(settings.canonicalTool, samples.at(-1)?.altKey ?? false),
});

const interpolateShiftLine = (
  start: ViewerBrushPoint,
  end: ViewerBrushPoint,
  sample: ViewerBrushPointerSample,
): readonly ViewerBrushPointerSample[] => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const steps = Math.max(Math.ceil(Math.hypot(dx, dy)), 2);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    return {
      ...sample,
      imagePoint: {
        ...(end.pressure === undefined ? {} : { pressure: end.pressure }),
        x: start.x + dx * progress,
        y: start.y + dy * progress,
      },
    };
  });
};

/** Keyed, framework-free authority for one brush stroke at a time. */
export const createViewerBrushInteractionController = (): ViewerBrushInteractionController => {
  let session: ViewerBrushSession | null = null;
  let identity: ViewerBrushSessionIdentity | null = null;
  let operationGeneration = 0;
  let lastCommittedPoint: ViewerBrushPoint | null = null;

  const cancel = (reason: ViewerBrushCancelReason): readonly ViewerBrushCommand[] => {
    if (session === null) return [];
    const command = { key: session.key, kind: 'cancel' as const, reason };
    session = null;
    return [command];
  };

  const synchronize = (context: ViewerBrushCurrentContext): readonly ViewerBrushCommand[] => {
    if (identity !== null && sameIdentity(identity, context)) return [];
    const commands = cancel('session-invalidated');
    const identityChanged =
      identity === null ||
      identity.imageSessionId !== context.imageSessionId ||
      identity.maskId !== context.maskId ||
      identity.sourceRevision !== context.sourceRevision;
    if (identityChanged) lastCommittedPoint = null;
    identity = {
      geometryEpoch: context.geometryEpoch,
      imageSessionId: context.imageSessionId,
      maskId: context.maskId,
      sourceRevision: context.sourceRevision,
      toolId: context.toolId,
    };
    return commands;
  };

  return {
    begin: (context, sample, settings) => {
      synchronize(context);
      if (!context.active || session !== null) return [];
      operationGeneration += 1;
      const key = { ...identity!, operationGeneration };
      if (sample.shiftKey && lastCommittedPoint !== null) {
        const samples = interpolateShiftLine(lastCommittedPoint, sample.imagePoint, sample);
        const line = lineFromSamples(samples, settings);
        lastCommittedPoint = line.points.at(-1) ?? lastCommittedPoint;
        return [{ key, kind: 'commit', line }];
      }
      session = { key, pointerId: sample.pointerId, samples: [sample], settings };
      return [{ key, kind: 'begin' }];
    },
    cancel,
    end: (context, sample) => {
      synchronize(context);
      if (session === null) return [];
      if (sample !== undefined && sample.pointerId !== session.pointerId) return [];
      const completed =
        sample === undefined || session.samples.at(-1) === sample
          ? session
          : { ...session, samples: [...session.samples, sample] };
      const line = lineFromSamples(completed.samples, completed.settings);
      const command = { key: completed.key, kind: 'commit' as const, line };
      session = null;
      lastCommittedPoint = line.points.at(-1) ?? lastCommittedPoint;
      return [command];
    },
    move: (context, sample) => {
      synchronize(context);
      if (session === null || sample.pointerId !== session.pointerId) return [];
      const last = session.samples.at(-1);
      if (last !== undefined) {
        const dx = sample.viewPoint.x - last.viewPoint.x;
        const dy = sample.viewPoint.y - last.viewPoint.y;
        if (dx * dx + dy * dy < 4) return [];
      }
      session = { ...session, samples: [...session.samples, sample] };
      return [{ key: session.key, kind: 'update' }];
    },
    overlays: () =>
      session === null
        ? []
        : [
            {
              geometryEpoch: session.key.geometryEpoch,
              id: `brush:${session.key.operationGeneration}`,
              imageLine: lineFromSamples(session.samples, session.settings),
              pointerPolicy: 'none',
              zOrder: 'active-tool',
            },
          ],
    synchronize,
  };
};

export const isViewerBrushCommandCurrent = (key: ViewerBrushSessionKey, context: ViewerBrushCurrentContext): boolean =>
  sameIdentity(key, context);
