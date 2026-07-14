import type { Adjustments } from '../../../utils/adjustments';
import type { PointColorPickerResponse } from '../../../utils/color/pointColorPicker';
import type { ToneEqualizerPickerResponse } from '../../../utils/toneEqualizerPicker';

export type ViewerPickerToolId = 'point-color' | 'tone-equalizer';

export interface ViewerPickerSessionKey {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly operationGeneration: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly toolId: ViewerPickerToolId;
}

export interface ViewerPickerPoint {
  readonly normalizedImagePoint: { readonly x: number; readonly y: number };
  readonly viewPoint: { readonly x: number; readonly y: number };
}

export interface ViewerPickerOverlayDescriptor extends ViewerPickerPoint {
  readonly ariaLabel: string;
  readonly geometryEpoch: number;
  readonly id: string;
  readonly status: 'sampling' | 'ready';
  readonly toolId: ViewerPickerToolId;
}

export type ViewerPickerCommand =
  | {
      readonly adjustments: Adjustments;
      readonly key: ViewerPickerSessionKey;
      readonly kind: 'sample-point-color' | 'sample-tone-equalizer';
      readonly normalizedImagePoint: ViewerPickerPoint['normalizedImagePoint'];
    }
  | {
      readonly baseline: Adjustments;
      readonly deltaEv: number;
      readonly kind: 'commit-tone-equalizer';
      readonly result: ToneEqualizerPickerResponse;
    }
  | { readonly kind: 'commit-point-color'; readonly ordinal: number; readonly result: PointColorPickerResponse }
  | { readonly kind: 'clear-point-color-receipt' | 'clear-tone-equalizer-receipt' }
  | { readonly kind: 'deactivate-point-color' }
  | { readonly kind: 'publish-point-color-receipt'; readonly result: PointColorPickerResponse }
  | { readonly kind: 'publish-tone-equalizer-receipt'; readonly result: ToneEqualizerPickerResponse };

interface ToneSession extends ViewerPickerPoint {
  readonly baseline: Adjustments;
  readonly key: ViewerPickerSessionKey & { readonly toolId: 'tone-equalizer' };
  readonly pointerId: number;
  readonly startClientY: number;
  currentClientY: number;
  released: boolean;
  result: ToneEqualizerPickerResponse | null;
  readonly toolId: 'tone-equalizer';
}

interface PointSession extends ViewerPickerPoint {
  readonly key: ViewerPickerSessionKey & { readonly toolId: 'point-color' };
  readonly ordinal: number;
  readonly pointerId: number;
  readonly toolId: 'point-color';
}

type PickerSession = PointSession | ToneSession;

export interface ViewerPickerCurrentContext {
  readonly activeTool: ViewerPickerToolId | null;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export const isViewerPickerSessionCurrent = (
  key: ViewerPickerSessionKey,
  current: ViewerPickerCurrentContext,
): boolean =>
  current.activeTool === key.toolId &&
  current.geometryEpoch === key.geometryEpoch &&
  current.imageSessionId === key.imageSessionId &&
  current.sourceIdentity === key.sourceIdentity &&
  current.sourceRevision === key.sourceRevision;

export const resolveViewerPickerPoint = (
  normalizedImagePoint: ViewerPickerPoint['normalizedImagePoint'],
  displayedImageRect: { readonly height: number; readonly width: number; readonly x: number; readonly y: number },
): ViewerPickerPoint => ({
  normalizedImagePoint,
  viewPoint: {
    x: displayedImageRect.x + normalizedImagePoint.x * displayedImageRect.width,
    y: displayedImageRect.y + normalizedImagePoint.y * displayedImageRect.height,
  },
});

const responseMatchesKey = (
  result: PointColorPickerResponse | ToneEqualizerPickerResponse,
  key: ViewerPickerSessionKey,
): boolean => result.graphRevision === key.sourceRevision && result.sourceIdentity === key.sourceIdentity;

const toneDeltaEv = (session: ToneSession): number =>
  Math.max(-4, Math.min(4, (session.startClientY - session.currentClientY) / 80));

export interface ViewerPickerInteractionController {
  beginPointColor(input: {
    adjustments: Adjustments;
    key: ViewerPickerSessionKey & { readonly toolId: 'point-color' };
    point: ViewerPickerPoint;
    pointerId: number;
  }): readonly ViewerPickerCommand[];
  beginToneEqualizer(input: {
    adjustments: Adjustments;
    clientY: number;
    key: ViewerPickerSessionKey & { readonly toolId: 'tone-equalizer' };
    point: ViewerPickerPoint;
    pointerId: number;
  }): readonly ViewerPickerCommand[];
  cancel(): readonly ViewerPickerCommand[];
  fail(key: ViewerPickerSessionKey, current: ViewerPickerCurrentContext): readonly ViewerPickerCommand[];
  move(pointerId: number, clientY: number): void;
  overlays(): readonly ViewerPickerOverlayDescriptor[];
  receivePointColor(
    key: ViewerPickerSessionKey,
    result: PointColorPickerResponse,
    current: ViewerPickerCurrentContext,
  ): readonly ViewerPickerCommand[];
  receiveToneEqualizer(
    key: ViewerPickerSessionKey,
    result: ToneEqualizerPickerResponse,
    current: ViewerPickerCurrentContext,
  ): readonly ViewerPickerCommand[];
  release(pointerId: number, clientY: number): readonly ViewerPickerCommand[];
}

export interface ViewerPickerContextSynchronizer {
  synchronize(context: ViewerPickerCurrentContext): readonly ViewerPickerCommand[];
}

const pickerContextIdentity = (context: ViewerPickerCurrentContext): string =>
  JSON.stringify([
    context.activeTool,
    context.geometryEpoch,
    context.imageSessionId,
    context.sourceIdentity,
    context.sourceRevision,
  ]);

/** Invalidates before a render can accept input, avoiding activation/effect races. */
export const createViewerPickerContextSynchronizer = (
  controller: Pick<ViewerPickerInteractionController, 'cancel'>,
): ViewerPickerContextSynchronizer => {
  let identity: string | null = null;
  return {
    synchronize: (context) => {
      const nextIdentity = pickerContextIdentity(context);
      if (identity === null) {
        identity = nextIdentity;
        return [];
      }
      if (identity === nextIdentity) return [];
      identity = nextIdentity;
      return controller.cancel();
    },
  };
};

export const createViewerPickerInteractionController = (): ViewerPickerInteractionController => {
  let session: PickerSession | null = null;
  const clearReceipt = (toolId: ViewerPickerToolId): ViewerPickerCommand => ({
    kind: toolId === 'point-color' ? 'clear-point-color-receipt' : 'clear-tone-equalizer-receipt',
  });
  const finishTone = (tone: ToneSession): readonly ViewerPickerCommand[] => {
    if (tone.result === null) return [];
    session = null;
    return [
      { kind: 'commit-tone-equalizer', baseline: tone.baseline, deltaEv: toneDeltaEv(tone), result: tone.result },
    ];
  };
  return {
    beginPointColor: ({ adjustments, key, point, pointerId }) => {
      if (session !== null) return [];
      session = { ...point, key, ordinal: adjustments.pointColor.points.length + 1, pointerId, toolId: 'point-color' };
      return [{ adjustments, key, kind: 'sample-point-color', normalizedImagePoint: point.normalizedImagePoint }];
    },
    beginToneEqualizer: ({ adjustments, clientY, key, point, pointerId }) => {
      if (session !== null) return [];
      session = {
        ...point,
        baseline: adjustments,
        currentClientY: clientY,
        key,
        pointerId,
        released: false,
        result: null,
        startClientY: clientY,
        toolId: 'tone-equalizer',
      };
      return [{ adjustments, key, kind: 'sample-tone-equalizer', normalizedImagePoint: point.normalizedImagePoint }];
    },
    cancel: () => {
      if (session === null) return [];
      const command = clearReceipt(session.toolId);
      session = null;
      return [command];
    },
    fail: (key, current) => {
      if (session === null || session.key.operationGeneration !== key.operationGeneration) return [];
      if (!isViewerPickerSessionCurrent(key, current)) return [];
      const command = clearReceipt(key.toolId);
      session = null;
      return [command];
    },
    move: (pointerId, clientY) => {
      if (session?.toolId === 'tone-equalizer' && session.pointerId === pointerId) session.currentClientY = clientY;
    },
    overlays: () =>
      session === null
        ? []
        : [
            {
              ariaLabel: `${session.toolId} sample point`,
              geometryEpoch: session.key.geometryEpoch,
              id: `${session.toolId}:${session.key.operationGeneration}`,
              normalizedImagePoint: session.normalizedImagePoint,
              status: session.toolId === 'tone-equalizer' && session.result !== null ? 'ready' : 'sampling',
              toolId: session.toolId,
              viewPoint: session.viewPoint,
            },
          ],
    receivePointColor: (key, result, current) => {
      if (
        session?.toolId !== 'point-color' ||
        session.key.operationGeneration !== key.operationGeneration ||
        !isViewerPickerSessionCurrent(key, current) ||
        !responseMatchesKey(result, key)
      )
        return [];
      const ordinal = session.ordinal;
      session = null;
      return [
        { kind: 'commit-point-color', ordinal, result },
        { kind: 'deactivate-point-color' },
        { kind: 'publish-point-color-receipt', result },
      ];
    },
    receiveToneEqualizer: (key, result, current) => {
      if (
        session?.toolId !== 'tone-equalizer' ||
        session.key.operationGeneration !== key.operationGeneration ||
        !isViewerPickerSessionCurrent(key, current) ||
        !responseMatchesKey(result, key)
      )
        return [];
      session.result = result;
      const commands: ViewerPickerCommand[] = [{ kind: 'publish-tone-equalizer-receipt', result }];
      if (session.released) commands.push(...finishTone(session));
      return commands;
    },
    release: (pointerId, clientY) => {
      if (session?.toolId !== 'tone-equalizer' || session.pointerId !== pointerId) return [];
      session.currentClientY = clientY;
      session.released = true;
      return finishTone(session);
    },
  };
};
